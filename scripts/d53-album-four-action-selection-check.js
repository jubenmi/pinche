import fs from "node:fs";
import path from "node:path";
import { parse as parseJavaScript, parseExpression } from "@babel/parser";
import { parse as parseSfc } from "@vue/compiler-sfc";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`D53 required file is missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseModule(source, label) {
  try {
    return parseJavaScript(source, { sourceType: "module" });
  } catch (error) {
    throw new Error(`${label} must parse as JavaScript: ${error.message}`);
  }
}

function parseTemplateExpression(expression, label) {
  assert(expression?.content, `${label} must have an expression`);
  try {
    return expression.ast || parseExpression(expression.content);
  } catch (error) {
    throw new Error(`${label} must parse as an expression: ${error.message}`);
  }
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type !== "string") return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (["comments", "end", "extra", "loc", "start", "tokens"].includes(key)) continue;
    if (value && typeof value === "object") walk(value, visit);
  }
}

function walkTemplate(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkTemplate(child, visit);
    return;
  }
  if (node.type === 1) visit(node);
  if (node.children) walkTemplate(node.children, visit);
  if (node.branches) walkTemplate(node.branches, visit);
}

function findNodes(node, predicate) {
  const matches = [];
  walk(node, (candidate) => {
    if (predicate(candidate)) matches.push(candidate);
  });
  return matches;
}

function findTemplateElements(node, predicate) {
  const matches = [];
  walkTemplate(node, (element) => {
    if (predicate(element)) matches.push(element);
  });
  return matches;
}

function keyName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "StringLiteral" || node.type === "NumericLiteral") return String(node.value);
  return null;
}

function objectProperty(object, name) {
  assert(object?.type === "ObjectExpression", `${name} must be read from an object expression`);
  const matches = object.properties.filter(
    (property) =>
      (property.type === "ObjectProperty" || property.type === "ObjectMethod") &&
      keyName(property.key) === name
  );
  return matches.at(-1) || null;
}

function objectValue(object, name, label) {
  const property = objectProperty(object, name);
  assert(property, `${label} must define ${name}`);
  assert(property.type === "ObjectProperty", `${label}.${name} must be a property`);
  return property.value;
}

function literalValue(node) {
  if (node?.type === "StringLiteral" || node?.type === "NumericLiteral" || node?.type === "BooleanLiteral") {
    return node.value;
  }
  if (node?.type === "NullLiteral") return null;
  return undefined;
}

function isIdentifier(node, name) {
  return node?.type === "Identifier" && node.name === name;
}

function isThisMember(node, name) {
  return (
    node?.type === "MemberExpression" &&
    node.object?.type === "ThisExpression" &&
    ((!node.computed && isIdentifier(node.property, name)) ||
      (node.computed && literalValue(node.property) === name))
  );
}

function memberPath(node) {
  const parts = [];
  let current = node;
  while (current?.type === "MemberExpression") {
    const property = keyName(current.property);
    if (!property) return null;
    parts.unshift(property);
    current = current.object;
  }
  if (current?.type !== "Identifier") return null;
  parts.unshift(current.name);
  return parts;
}

function sourceFor(node, source, label) {
  assert(Number.isInteger(node?.start) && Number.isInteger(node?.end), `${label} must have source positions`);
  const text = source.slice(node.start, node.end);
  assert(text.trim(), `${label} must have executable source`);
  return text;
}

function exportDefaultObject(program) {
  const declaration = program.program.body.find(
    (statement) => statement.type === "ExportDefaultDeclaration" && statement.declaration?.type === "ObjectExpression"
  );
  assert(declaration, "album script must export a default options object");
  return declaration.declaration;
}

function optionMethod(options, section, name, scriptSource) {
  const sectionObject = objectValue(options, section, "album options");
  assert(sectionObject.type === "ObjectExpression", `album ${section} must be an object`);
  const property = objectProperty(sectionObject, name);
  assert(property, `album ${section} must define ${name}()`);
  const functionNode = property.type === "ObjectMethod" ? property : property.value;
  assert(
    ["ArrowFunctionExpression", "FunctionExpression", "ObjectMethod"].includes(functionNode?.type),
    `album ${section}.${name} must be a function`
  );
  return { node: functionNode, source: sourceFor(functionNode, scriptSource, `album ${section}.${name}`) };
}

function assignmentsToThisProperty(node, name) {
  return findNodes(
    node.body,
    (candidate) =>
      candidate.type === "AssignmentExpression" && isThisMember(candidate.left, name)
  );
}

function assignsLiteral(node, property, value) {
  return assignmentsToThisProperty(node, property).some(
    (assignment) => literalValue(assignment.right) === value
  );
}

function containsObjectProperty(node, name, value) {
  return findNodes(node.body, (candidate) => {
    if (candidate.type !== "ObjectExpression") return false;
    const property = objectProperty(candidate, name);
    return property?.type === "ObjectProperty" && literalValue(property.value) === value;
  }).length > 0;
}

function containsObjectPropertyIdentifier(node, name, identifier) {
  return findNodes(node.body, (candidate) => {
    if (candidate.type !== "ObjectExpression") return false;
    const property = objectProperty(candidate, name);
    return property?.type === "ObjectProperty" && isIdentifier(property.value, identifier);
  }).length > 0;
}

function hasDownloadableFilter(node, property) {
  return findNodes(node.body, (candidate) => {
    if (candidate.type !== "CallExpression" || keyName(candidate.callee?.property) !== "filter") return false;
    return isThisMember(candidate.callee.object, property);
  }).length > 0;
}

function containsEquality(node, property, value) {
  return findNodes(node, (candidate) => {
    if (candidate.type !== "BinaryExpression" || !["===", "=="].includes(candidate.operator)) return false;
    return (
      (isThisMember(candidate.left, property) && literalValue(candidate.right) === value) ||
      (isThisMember(candidate.right, property) && literalValue(candidate.left) === value)
    );
  }).length > 0;
}

function isNestedIn(ancestor, node) {
  return (
    Number.isInteger(ancestor?.start) &&
    Number.isInteger(ancestor?.end) &&
    Number.isInteger(node?.start) &&
    Number.isInteger(node?.end) &&
    ancestor.start <= node.start &&
    ancestor.end >= node.end
  );
}

function assertSelectionPersistsAcrossFilter(watcher, name) {
  const tagGuards = findNodes(
    watcher.node.body,
    (candidate) => candidate.type === "IfStatement" && containsEquality(candidate.test, "selectionModePurpose", "tag")
  );
  assert(tagGuards.length > 0, `${name} may clear selection only for tag mode`);
  for (const property of ["selectionMode", "selectedPhotoIds"]) {
    for (const reset of assignmentsToThisProperty(watcher.node, property)) {
      assert(
        tagGuards.some((guard) => isNestedIn(guard.consequent, reset)),
        `${name} must not clear share/download selection outside its tag-only branch`
      );
    }
  }
}

function hasStaticClass(element, className) {
  return element.props.some(
    (property) =>
      property.type === 6 &&
      property.name === "class" &&
      property.value?.content.split(/\s+/).includes(className)
  );
}

function directive(element, name, argument) {
  return element.props.find(
    (property) =>
      property.type === 7 &&
      property.name === name &&
      property.arg?.isStatic &&
      property.arg.content === argument
  );
}

function hasFalseIf(element) {
  const condition = directive(element, "if", undefined) || element.props.find(
    (property) => property.type === 7 && property.name === "if"
  );
  if (!condition?.exp) return false;
  return literalValue(parseTemplateExpression(condition.exp, "v-if")) === false;
}

function templateText(node) {
  if (!node || typeof node !== "object") return "";
  if (Array.isArray(node)) return node.map(templateText).join("");
  if (node.type === 2) return node.content;
  return templateText(node.children || []);
}

function tapBindsMethod(element, method) {
  const tap = directive(element, "on", "tap");
  if (!tap?.exp) return false;
  const expression = parseTemplateExpression(tap.exp, `@tap for ${method}`);
  return (
    isIdentifier(expression, method) ||
    (expression.type === "CallExpression" && isIdentifier(expression.callee, method))
  );
}

function hasDisabledWhenSelectionIsEmpty(element, label) {
  const binding = directive(element, "bind", "disabled");
  assert(binding?.exp, `${label} must bind :disabled`);
  const expression = parseTemplateExpression(binding.exp, `${label} :disabled`);
  return findNodes(expression, (candidate) => {
    if (candidate.type !== "BinaryExpression" || !["===", "=="].includes(candidate.operator)) return false;
    return (
      (isIdentifier(candidate.left, "selectedPhotoCount") && literalValue(candidate.right) === 0) ||
      (isIdentifier(candidate.right, "selectedPhotoCount") && literalValue(candidate.left) === 0)
    );
  }).length > 0;
}

function findAction(elements, label, method) {
  const matches = elements.filter(
    (element) => templateText(element).trim().includes(label) && tapBindsMethod(element, method)
  );
  assert(matches.length === 1, `${label} must bind ${method} on its action element`);
  assert(!hasFalseIf(matches[0]), `${label} must not be hidden with v-if=\"false\"`);
  return matches[0];
}

function exportedFunction(program, name, label) {
  for (const statement of program.program.body) {
    if (statement.type !== "ExportNamedDeclaration" || !statement.declaration) continue;
    if (statement.declaration.type === "FunctionDeclaration" && statement.declaration.id?.name === name) {
      return statement.declaration;
    }
    if (statement.declaration.type !== "VariableDeclaration") continue;
    const declarator = statement.declaration.declarations.find((candidate) => candidate.id?.name === name);
    if (declarator?.init?.type === "ArrowFunctionExpression" || declarator?.init?.type === "FunctionExpression") {
      return declarator.init;
    }
  }
  throw new Error(`${label} must export ${name}`);
}

function functionNamed(program, name, label) {
  const match = findNodes(
    program,
    (candidate) =>
      (candidate.type === "FunctionDeclaration" || candidate.type === "FunctionExpression") &&
      candidate.id?.name === name
  ).at(-1);
  assert(match, `${label} must define ${name}`);
  return match;
}

function callsIdentifier(node, name) {
  return findNodes(node.body, (candidate) =>
    candidate.type === "CallExpression" && isIdentifier(candidate.callee, name)
  ).length > 0;
}

function hasReturnObject(node, propertyName, expectedValue) {
  return findNodes(node.body, (candidate) => {
    if (candidate.type !== "ReturnStatement" || candidate.argument?.type !== "ObjectExpression") return false;
    const property = objectProperty(candidate.argument, propertyName);
    return property?.type === "ObjectProperty" && literalValue(property.value) === expectedValue;
  }).length > 0;
}

function variableDeclarator(node, name) {
  return findNodes(node.body, (candidate) =>
    candidate.type === "VariableDeclarator" && isIdentifier(candidate.id, name)
  ).at(-1);
}

function templateLiteralNavigatesToRecruitment(node) {
  return findNodes(node.body, (candidate) => {
    if (candidate.type !== "TemplateLiteral" || candidate.expressions.length !== 1) return false;
    const [prefix, suffix] = candidate.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw);
    return (
      prefix === "/pages/session/share?id=" &&
      suffix === "" &&
      isThisMember(candidate.expressions[0], "sessionId")
    );
  }).length > 0;
}

function containsAlbumEntryParameter(node) {
  return findNodes(node.body, (candidate) => {
    if (candidate.type === "StringLiteral") return candidate.value.includes("entry=album");
    if (candidate.type === "TemplateLiteral") {
      return candidate.quasis.some((quasi) => (quasi.value.cooked ?? quasi.value.raw).includes("entry=album"));
    }
    return false;
  }).length > 0;
}

const requirements = read(".kiro/specs/album-four-action-selection-workbench/requirements.md");
const design = read(".kiro/specs/album-four-action-selection-workbench/design.md");
const albumSource = read("apps/miniprogram/src/pages/session/album.vue");
const albumSfc = parseSfc(albumSource, { filename: "apps/miniprogram/src/pages/session/album.vue" });
assert(albumSfc.errors.length === 0, "album SFC must parse without errors");
assert(albumSfc.descriptor.template?.ast, "album must contain a compiled <template> block");
assert(albumSfc.descriptor.script?.content, "album must contain an executable <script> block");
const albumTemplate = albumSfc.descriptor.template.ast;
const albumScript = albumSfc.descriptor.script.content;
const albumProgram = parseModule(albumScript, "album script");
const albumOptions = exportDefaultObject(albumProgram);
const serviceProgram = parseModule(read("apps/api/src/modules/core/service.js"), "album service");
const serverProgram = parseModule(read("apps/api/src/server.js"), "server");
const packageJson = read("package.json");

for (const token of ["scope: \"all\"", "mediaIds", "ALBUM_PUBLIC_SHARE_SELECTION_INVALID"]) {
  assert(requirements.includes(token) || design.includes(token), `D53 spec must define ${token}`);
}

const actionGroup = findTemplateElements(albumTemplate, (element) => hasStaticClass(element, "album-action-groups"));
assert(actionGroup.length === 1, "album must contain exactly one .album-action-groups element");
assert(!hasFalseIf(actionGroup[0]), ".album-action-groups must not be hidden with v-if=\"false\"");
const groupActions = actionGroup[0].children.filter((child) => child.type === 1);
const expectedActions = [
  ["分享", "openShareSelectionMode"],
  ["下载", "openDownloadSelectionMode"],
  ["标注", "openTagSelectionMode"],
  ["招募", "openRecruitment"]
];
const actionIndices = expectedActions.map(([label, method]) => {
  const element = findAction(groupActions, label, method);
  return groupActions.indexOf(element);
});
assert(
  actionIndices.every((index, position) => position === 0 || actionIndices[position - 1] < index),
  `album actions must include ${expectedActions.map(([label]) => label).join("、")} in order`
);
const allTemplateElements = findTemplateElements(albumTemplate, () => true);
for (const legacyLabel of ["预览并分享", "全部下载", "多选下载", "批量标注"]) {
  assert(
    !allTemplateElements.some((element) => templateText(element).trim() === legacyLabel && directive(element, "on", "tap")),
    `${legacyLabel} must not remain a normal action button`
  );
}

const openShareSelection = optionMethod(albumOptions, "methods", "openShareSelectionMode", albumScript);
assert(openShareSelection.source.length > 0 && assignsLiteral(openShareSelection.node, "selectionModePurpose", "share"), "share action must enter share selection directly");
const openDownloadSelection = optionMethod(albumOptions, "methods", "openDownloadSelectionMode", albumScript);
assert(openDownloadSelection.source.length > 0 && assignsLiteral(openDownloadSelection.node, "selectionModePurpose", "download"), "download action must enter download selection directly");

const shareAllAction = findAction(allTemplateElements, "分享全部", "shareAllAlbumMedia");
const shareSelectedAction = findAction(allTemplateElements, "分享选中", "shareSelectedAlbumMedia");
assert(hasDisabledWhenSelectionIsEmpty(shareSelectedAction, "分享选中"), "分享选中 must disable only when the share selection is empty");
const downloadAllAction = findAction(allTemplateElements, "下载全部", "downloadAllPhotos");
const downloadSelectedAction = findAction(allTemplateElements, "下载选中", "downloadSelectedPhotos");
assert(hasDisabledWhenSelectionIsEmpty(downloadSelectedAction, "下载选中"), "下载选中 must disable only when the download selection is empty");
assert(shareAllAction && downloadAllAction, "share and download all actions must be visible");

const shareAllMethod = optionMethod(albumOptions, "methods", "shareAllAlbumMedia", albumScript);
assert(containsObjectProperty(shareAllMethod.node, "scope", "all"), "分享全部 must submit scope: all");
const shareSelectedMethod = optionMethod(albumOptions, "methods", "shareSelectedAlbumMedia", albumScript);
assert(containsObjectPropertyIdentifier(shareSelectedMethod.node, "mediaIds", "mediaIds"), "分享选中 must submit selected mediaIds");
const downloadSelectedMethod = optionMethod(albumOptions, "methods", "downloadSelectedPhotos", albumScript);
assert(
  hasDownloadableFilter(downloadSelectedMethod.node, "downloadablePhotos") &&
    !hasDownloadableFilter(downloadSelectedMethod.node, "filteredDownloadablePhotos"),
  "下载选中 must resolve from complete downloadablePhotos, not the current filter"
);
assertSelectionPersistsAcrossFilter(optionMethod(albumOptions, "watch", "activeFilter", albumScript), "activeFilter");
assertSelectionPersistsAcrossFilter(optionMethod(albumOptions, "watch", "selectedRoleFilter", albumScript), "selectedRoleFilter");
assert(
  findTemplateElements(shareAllAction, (element) => element.tag === "ShareIcon").length > 0 &&
    findTemplateElements(groupActions[actionIndices[3]], (element) => element.tag === "UserAddIcon").length > 0,
  "share and recruitment must use distinct icons"
);
assert(hasStaticClass(groupActions[actionIndices[2]], "tag-action"), "tag action must retain its green primary style");
const recruitmentMethod = optionMethod(albumOptions, "methods", "openRecruitment", albumScript);
assert(templateLiteralNavigatesToRecruitment(recruitmentMethod.node), "recruitment must navigate to the invitation page");
assert(!containsAlbumEntryParameter(recruitmentMethod.node), "recruitment must not pass entry=album");

const shareScopeNormalizer = exportedFunction(serviceProgram, "normalizeSessionAlbumPublicShareScope", "public share scope normalizer");
const specifiedCount = variableDeclarator(shareScopeNormalizer, "specifiedCount");
assert(
  specifiedCount?.init && ["hasScope", "hasMediaIds", "hasFocusMediaId"].every((name) => findNodes(specifiedCount.init, (node) => isIdentifier(node, name)).length > 0) &&
    findNodes(shareScopeNormalizer.body, (node) =>
      node.type === "BinaryExpression" && node.operator === ">" && isIdentifier(node.left, "specifiedCount") && literalValue(node.right) === 1
    ).length > 0 &&
    callsIdentifier(shareScopeNormalizer, "publicShareSelectionInvalid"),
  "scope, mediaIds, and focusMediaId must be mutually exclusive"
);
assert(
  hasReturnObject(shareScopeNormalizer, "mode", "all") && hasReturnObject(shareScopeNormalizer, "mode", "selected"),
  "scope normalizer must emit explicit all and selected modes"
);
assert(callsIdentifier(shareScopeNormalizer, "publicShareSelectionInvalid"), "selected input failures must use the stable selection-invalid error");
const snapshotNormalizer = exportedFunction(serviceProgram, "normalizePublicShareSnapshotIds", "snapshot ID normalizer");
const max = variableDeclarator(snapshotNormalizer, "max");
assert(
  max?.init?.type === "ConditionalExpression" &&
    max.init.test.type === "BinaryExpression" &&
    max.init.test.operator === "===" &&
    isThisMember(max.init.test.left, "max") === false &&
    memberPath(max.init.test.left)?.join(".") === "options.max" &&
    max.init.test.right?.type === "Identifier" &&
    max.init.test.right.name === "undefined" &&
    memberPath(max.init.consequent)?.join(".") === "Number.POSITIVE_INFINITY",
  "snapshot media IDs must not retain the legacy 30-item default cap"
);
const shareTokenOptions = exportedFunction(serverProgram, "publicShareTokenOptions", "share token option forwarding");
assert(
  findNodes(shareTokenOptions.body, (node) =>
    node.type === "ForOfStatement" &&
    node.right?.type === "ArrayExpression" &&
    ["scope", "mediaIds", "focusMediaId"].every((value) => node.right.elements.some((element) => literalValue(element) === value))
  ).length > 0 &&
    findNodes(shareTokenOptions.body, (node) =>
      node.type === "CallExpression" &&
      memberPath(node.callee)?.join(".") === "Object.prototype.hasOwnProperty.call" &&
      isIdentifier(node.arguments[0], "body") &&
      isIdentifier(node.arguments[1], "key")
    ).length > 0,
  "share-token forwarding must copy only explicitly supplied scope fields"
);
const route = functionNamed(serverProgram, "route", "share-token route");
const shareOptions = variableDeclarator(route, "shareOptions");
assert(
  shareOptions?.init?.type === "CallExpression" &&
    isIdentifier(shareOptions.init.callee, "publicShareTokenOptions") &&
    isIdentifier(shareOptions.init.arguments[0], "body") &&
    findNodes(route.body, (node) =>
      node.type === "CallExpression" &&
      isIdentifier(node.callee, "createOrReuseSessionAlbumPublicShare") &&
      node.arguments.some((argument) => isIdentifier(argument, "shareOptions"))
    ).length > 0,
  "share-token route must pass its own-field options into the service"
);
const packageScripts = JSON.parse(packageJson).scripts || {};
assert(
  packageScripts["d53:unit"] === "node --test apps/api/test/album-share-selection.test.mjs" &&
    packageScripts["d53:check"] === "node scripts/d53-album-four-action-selection-check.js" &&
    packageScripts["d53:smoke"] === "node scripts/d53-album-four-action-selection-smoke.js" &&
    String(packageScripts.check || "").includes("node scripts/d53-album-four-action-selection-check.js"),
  "package scripts must expose D53 verification and include its static check"
);

console.log("D53 album four-action and explicit share-scope checks passed");
