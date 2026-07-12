const PROFILE_PATCH_FIELDS = Object.freeze(["nickname", "avatarUrl", "gender"]);

export function profileTextSnapshot(actor = {}) {
  return {
    id: Number(actor.id),
    nickname: String(actor.nickname || ""),
    avatar_url: actor.avatarUrl ? String(actor.avatarUrl) : null,
    gender: String(actor.gender || "")
  };
}

export function profilePatchFromProposalBody(body = {}) {
  const patch = {};
  for (const key of PROFILE_PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
  }
  return patch;
}
