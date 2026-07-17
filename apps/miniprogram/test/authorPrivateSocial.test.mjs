import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  authorPrivateMessageView,
  publicChatMessages
} from "../src/extensions/session-pseudo-chat/api.js";

function dto() {
  return {
    draft_id: 91,
    content_ref: "text-proposal:91",
    publication_state: "author_only",
    moderation_status: "rejected",
    moderation_message: "仅自己可见 · 未通过",
    published_id: null,
    content: { is_draft: true, content: "被拒消息" },
    can_edit: true,
    can_delete: true,
    can_resubmit: true
  };
}

test("D46 app chat keeps a rejected sender draft editable but out of unread messages", () => {
  const message = authorPrivateMessageView(dto(), 7);
  assert.equal(message.author_private.can_resubmit, true);
  assert.deepEqual(publicChatMessages([{ id: 3 }, message]), [{ id: 3 }]);
});

test("D46 review, chat, and pinned UI expose cancel and rejected replacement without public actions", async () => {
  const [review, chat, pinned] = await Promise.all([
    readFile(new URL("../src/pages/session/review.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/extensions/session-pseudo-chat/ChatEntry.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/extensions/session-pseudo-chat/ManagePinnedMessage.vue", import.meta.url), "utf8")
  ]);
  assert.match(review, /activeDraft/);
  assert.match(review, /replaces_draft_id/);
  assert.match(review, /cancelDraft/);
  assert.match(chat, /publicChatMessages/);
  assert.match(chat, /editRejectedMessage/);
  assert.match(chat, /cancelMessageDraft/);
  assert.match(pinned, /replacementDraftId/);
  assert.match(pinned, /cancelPinnedDraft/);
  for (const source of [review, chat, pinned]) {
    assert.match(source, /author_private/);
  }
});
