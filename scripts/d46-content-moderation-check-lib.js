import assert from "node:assert/strict";

export function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source section: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source section end: ${endMarker}`);
  return source.slice(start, end);
}

function canStartRegex(previousToken) {
  if (!previousToken) return true;
  if (
    previousToken.type === "keyword" &&
    ["return", "throw", "case", "delete", "void", "typeof", "new", "in", "of", "yield", "await"].includes(previousToken.value)
  ) {
    return true;
  }
  return previousToken.type === "punctuator" && [
    "(", "[", "{", ",", ":", ";", "=", "=>", "!", "&&", "||", "??", "?"
  ].includes(previousToken.value);
}

function skipRegexLiteral(source, index) {
  let inCharacterClass = false;
  for (index += 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "[") inCharacterClass = true;
    if (source[index] === "]") inCharacterClass = false;
    if (source[index] === "/" && !inCharacterClass) {
      while (/[a-z]/i.test(source[index + 1] || "")) index += 1;
      return index;
    }
  }
  return source.length;
}

function escapedCharacter(source, index) {
  const character = source[index + 1] || "";
  if (character === "u" && source[index + 2] === "{") {
    const closingBrace = source.indexOf("}", index + 3);
    const codePoint = source.slice(index + 3, closingBrace);
    if (
      closingBrace !== -1 &&
      /^[0-9a-f]{1,6}$/i.test(codePoint) &&
      Number.parseInt(codePoint, 16) <= 0x10ffff
    ) {
      return { nextIndex: closingBrace, value: String.fromCodePoint(Number.parseInt(codePoint, 16)) };
    }
  }
  if (character === "u" && /^[0-9a-f]{4}$/i.test(source.slice(index + 2, index + 6))) {
    return { nextIndex: index + 5, value: String.fromCharCode(Number.parseInt(source.slice(index + 2, index + 6), 16)) };
  }
  return { nextIndex: index + 1, value: character };
}

function tokenForWord(value) {
  return {
    type: ["return", "throw", "case", "delete", "void", "typeof", "new", "in", "of", "yield", "await"].includes(value)
      ? "keyword"
      : "identifier",
    value
  };
}

function executableCodeTokens(source) {
  const tokens = [];
  let previousToken;
  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith("<!--", index)) {
      index = source.indexOf("-->", index + 4);
      if (index === -1) break;
      index += 2;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      index = source.indexOf("*/", index + 2);
      if (index === -1) break;
      index += 1;
      continue;
    }
    if (source[index] === "/" && canStartRegex(previousToken)) {
      index = skipRegexLiteral(source, index);
      previousToken = { type: "literal", value: "regex" };
      tokens.push(previousToken);
      continue;
    }
    const quote = source[index];
    if (['"', "'", "`"].includes(quote)) {
      let value = "";
      for (index += 1; index < source.length; index += 1) {
        const character = source[index];
        if (character === "\\") {
          const escaped = escapedCharacter(source, index);
          value += escaped.value;
          index = escaped.nextIndex;
          continue;
        }
        if (character === quote) break;
        value += character;
      }
      previousToken = { type: "string", value };
      tokens.push(previousToken);
      continue;
    }
    const word = source.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0];
    if (word) {
      previousToken = tokenForWord(word);
      tokens.push(previousToken);
      index += word.length - 1;
      continue;
    }
    if (/\s/.test(source[index])) continue;
    const punctuator = source.slice(index, index + 2) === "=>"
      ? "=>"
      : source[index];
    previousToken = { type: "punctuator", value: punctuator };
    tokens.push(previousToken);
    index += punctuator.length - 1;
  }
  return tokens;
}

function sourceStringLiterals(source) {
  return executableCodeTokens(source)
    .filter((token) => token.type === "string")
    .map((token) => token.value);
}

function assertExecutableContentSecurityIntake(source, intake) {
  const tokens = executableCodeTokens(source);
  const expected = ["await", "resolveContentSecurityIntake", "(", intake, ")"];
  for (let index = 0; index <= tokens.length - expected.length; index += 1) {
    if (expected.every((value, offset) => tokens[index + offset]?.value === value)) return;
  }
  assert.fail(`missing executable content-security intake: ${intake}`);
}

function sourceTemplateText(source) {
  const trimmed = source.trimStart();
  const templateStart = source.indexOf("<template");
  const templateEnd = templateStart >= 0 ? source.indexOf("</template>", templateStart) : -1;
  const template = templateStart >= 0 && templateEnd >= 0
    ? source.slice(templateStart, templateEnd)
    : trimmed.startsWith("<") ? source : "";
  const withoutComments = template.replace(/<!--[\s\S]*?-->/g, "");
  return [...withoutComments.matchAll(/>([^<]+)</g)]
    .map((match) => match[1].replace(/&#(x[0-9a-f]+|\d+);/gi, (_, entity) => {
      const isHex = entity[0].toLowerCase() === "x";
      return String.fromCodePoint(Number.parseInt(entity.slice(isHex ? 1 : 0), isHex ? 16 : 10));
    }).trim())
    .filter(Boolean);
}

function isContentModerationPresentationSource(path) {
  return new Set([
    "apps/miniprogram/src/utils/contentModeration.js",
    "apps/miniprogram/src/utils/api.js",
    "apps/miniprogram/src/pages/session/album.vue",
    "apps/miniprogram/src/pages/session/review.vue"
  ]).has(path);
}

function isContentModerationCopy(value) {
  return ["审核", "内容安全", "暂无法提交", "无法发布", "安全服务"].some((anchor) => value.includes(anchor));
}

export function assertOnlyApprovedMiniProgramModerationCopy(path, source) {
  if (!isContentModerationPresentationSource(path)) return;
  const allowed = new Set([
    "内容正在安全审核",
    "内容未通过安全审核",
    "内容安全服务暂未就绪，暂时无法发布，请稍后再试"
  ]);
  for (const value of [...sourceStringLiterals(source), ...sourceTemplateText(source)]) {
    if (isContentModerationCopy(value)) {
      assert.equal(allowed.has(value), true, `unapproved mini-program moderation copy in ${path}: ${value}`);
    }
  }
}

export function assertDirectCosIntakeBranches(source) {
  for (const [kind, endMarker, intake] of [
    ["sessionAlbumPhoto", '  if (directUpload.kind === "adminSessionAlbumPhoto") {', "image"],
    ["adminSessionAlbumPhoto", '  if (directUpload.kind === "adminSessionAlbumVideo") {', "image"],
    [
      "adminSessionAlbumVideo",
      '  if (directUpload.kind === "avatar" || directUpload.kind === "sessionReviewPhoto") {',
      "video"
    ]
  ]) {
    const branch = sourceSection(
      source,
      `if (directUpload.kind === "${kind}") {`,
      endMarker
    );
    assert.match(branch, new RegExp(`resolveContentSecurityIntake\\("${intake}"\\)`));
  }
}

export function assertDirectCosIntentIntakeBranches(source) {
  for (const [kind, endMarker, intake] of [
    ["adminSessionAlbumVideo", "\n  const sourceExtension = normalizeUploadExtension(extension);", "video"],
    ["avatar", '\n  if (kind === "sessionReviewPhoto") {', "image"],
    ["sessionReviewPhoto", '\n  if (kind === "sessionAlbumPhoto" || kind === "adminSessionAlbumPhoto") {', "image"]
  ]) {
    const branch = sourceSection(
      source,
      `if (kind === "${kind}") {`,
      endMarker
    );
    assertExecutableContentSecurityIntake(branch, intake);
  }
}
