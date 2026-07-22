const ROLE_NAME_MAX_CODE_POINTS = 18;
const SCRIPT_NAME_MAX_CODE_POINTS = 22;

function truncateByCodePoints(value, maximum) {
  const codePoints = [...value];
  if (codePoints.length <= maximum) return value;
  return `${codePoints.slice(0, maximum - 1).join("")}…`;
}

function normalizedName(value, maximum) {
  return truncateByCodePoints(String(value ?? "").trim(), maximum);
}

export function albumShareCoverCopy({ scriptName = "", roleName = "" } = {}) {
  const script = normalizedName(scriptName, SCRIPT_NAME_MAX_CODE_POINTS);
  const role = normalizedName(roleName, ROLE_NAME_MAX_CODE_POINTS);

  return {
    label: "本场掉落",
    main: role ? `这一晚，我是「${role}」` : "这一晚，故事没有散场",
    subtitle: script ? `《${script}》 · 游玩相册` : "游玩相册"
  };
}

export function escapeAlbumShareCoverXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
