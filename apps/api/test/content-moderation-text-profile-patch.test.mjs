import assert from "node:assert/strict";
import test from "node:test";

import {
  profilePatchFromProposalBody,
  profileTextSnapshot
} from "../src/modules/content-moderation/text-profile-patch.js";
import { createTextBaseline } from "../src/modules/content-moderation/text-baseline.js";

test("profile proposal application retains only the approved patch fields", () => {
  assert.deepEqual(profilePatchFromProposalBody({
    nickname: "阿青",
    avatarUrl: "/uploads/avatars/a.png",
    gender: "female",
    phone: "13800138000",
    adminNote: "ignore",
    signedUrl: "https://private.example/signed"
  }), {
    nickname: "阿青",
    avatarUrl: "/uploads/avatars/a.png",
    gender: "female"
  });
});

test("profile baseline changes when nickname, avatar, or gender changes", () => {
  const actor = {
    id: 7,
    nickname: "旧昵称",
    avatarUrl: "/uploads/avatars/old.png",
    gender: "male"
  };
  const baseline = createTextBaseline({ kind: "user_profile", profile: profileTextSnapshot(actor) });

  for (const changes of [
    { nickname: "新昵称" },
    { avatarUrl: "/uploads/avatars/new.png" },
    { gender: "female" }
  ]) {
    assert.notEqual(
      baseline,
      createTextBaseline({
        kind: "user_profile",
        profile: profileTextSnapshot({ ...actor, ...changes })
      })
    );
  }
});
