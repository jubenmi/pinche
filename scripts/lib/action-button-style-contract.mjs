const BUTTON_SELECTOR =
  /(^|[,\s>+~])(?:button\b|\.(?:button|primary|secondary-action|action-button|mini-button|tool-button|bulk-action-button)\b|\.[\w-]*button[\w-]*)/i;
const NAMED_TEXT_ACTION_SELECTOR =
  /\.(?:message-panel-tool|profile-save|profile-logout|profile-close|phone-authorize|phone-skip|chat-modal-close|draft-button|maintenance-retry|role-action|city-location-action|album-image-viewer__primary-action)\b/i;
const EXEMPT_SELECTOR =
  /(?:disabled|\[disabled\]|danger|icon-button|button-icon|nav-item|sidebar-collapse|shell-toggle|tabs?\b|segmented|rating|status|toggle\b)/i;
const NEUTRAL_BACKGROUND =
  /background(?:-color)?\s*:\s*(#(?:fff|ffffff|fffefb|fffefc|f8fafc|f8faf9|eef2f7|eef3f1|64748b)\b|var\(--admin-(?:surface|surface-muted|border)\))/i;

export function extractStyleBlocks(source) {
  return [...String(source).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1]);
}

function cssSources(source) {
  const blocks = extractStyleBlocks(source);
  return blocks.length > 0 ? blocks : [String(source)];
}

export function findNeutralEnabledButtonRules(source, file, exceptions = []) {
  const violations = [];
  for (const css of cssSources(source)) {
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1].trim();
      if (
        (!BUTTON_SELECTOR.test(selector) && !NAMED_TEXT_ACTION_SELECTOR.test(selector)) ||
        EXEMPT_SELECTOR.test(selector)
      ) continue;
      const exempt = exceptions.some((entry) =>
        entry.file === file && entry.selector === selector && entry.reason
      );
      if (exempt) continue;
      const neutral = NEUTRAL_BACKGROUND.exec(match[2]);
      if (!neutral) continue;
      violations.push({ file, selector, value: neutral[1] });
    }
  }
  return violations;
}

function normalizeExpression(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

export function findClassOnlyDisabledBindings(source, file, exceptions = []) {
  const violations = [];
  const tags = String(source).match(/<(?:t-button|button)\b[\s\S]*?>/gi) || [];
  for (const tag of tags) {
    const classBinding = /:class\s*=\s*["'][^"']*disabled\s*:\s*([^,}]+)[^"']*["']/.exec(tag);
    if (!classBinding || /:disabled\s*=|\sdisabled(?:\s|>|=)/.test(tag)) continue;
    const expression = normalizeExpression(classBinding[1]);
    const exempt = exceptions.some((entry) =>
      entry.file === file && normalizeExpression(entry.expression) === expression && entry.reason
    );
    if (!exempt) violations.push({ file, expression });
  }
  return violations;
}

export function findMissingRequiredSourcePatterns(source, file, requirements) {
  const value = String(source);
  return requirements
    .filter(({ pattern }) => !pattern.test(value))
    .map(({ name }) => ({ file, name }));
}
