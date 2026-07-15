import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  mergeAuthorChatView,
  mergeAuthorReviewState
} from "../src/modules/content-moderation/author-social-read.js";

function dto({ id, publishedId = null, content, status = "review" }) {
  return {
    draft_id: id,
    content_ref: `text-proposal:${id}`,
    publication_state: "author_only",
    moderation_status: status,
    moderation_message: status === "rejected"
      ? "仅自己可见 · 未通过"
      : "仅自己可见 · 进一步审核",
    published_id: publishedId,
    content,
    can_edit: status === "rejected",
    can_delete: true,
    can_resubmit: status === "rejected"
  };
}

test("D46 review projection overlays only my editor state and remains outside public aggregates", () => {
  const projection = dto({
    id: 71,
    content: { rating: 5, content: "待审评价", photoUrls: ["/uploads/session-reviews/a.jpg"] }
  });
  assert.deepEqual(mergeAuthorReviewState({
    can_review: true,
    review: { id: 9, rating: 3, content: "公开旧评价", photos: [] }
  }, projection), {
    can_review: true,
    review: {
      id: 9,
      rating: 5,
      content: "待审评价",
      photos: ["/uploads/session-reviews/a.jpg"],
      author_private: projection
    }
  });
  assert.equal(mergeAuthorReviewState({ can_review: false, review: null }, null).review, null);
});

test("D46 chat projection creates one sender-only temporary bubble and pinned override", () => {
  const messageProjection = dto({
    id: 72,
    content: { is_draft: true, content: "待审消息" }
  });
  const pinProjection = dto({
    id: 73,
    publishedId: 12,
    content: { pinnedMessageText: "待审置顶" }
  });
  assert.deepEqual(mergeAuthorChatView({
    room: { id: 4, session_id: 12 },
    pinnedMessage: { id: 5, content: "公开旧置顶" },
    messages: [{ id: 6, content: "公开消息" }]
  }, {
    userId: 7,
    messageProjection,
    pinProjection
  }), {
    room: { id: 4, session_id: 12 },
    pinnedMessage: {
      id: 5,
      content: "待审置顶",
      author_private: pinProjection
    },
    messages: [
      { id: 6, content: "公开消息" },
      {
        id: null,
        draft_id: 72,
        sender_user_id: 7,
        sender_label: "我",
        message_type: "author_private",
        content: "待审消息",
        moderation_message: "仅自己可见 · 进一步审核",
        publication_state: "author_only",
        author_private: messageProjection
      }
    ]
  });
});

test("D46 review and talk reads are author-only while public review aggregation stays unchanged", async () => {
  const [core, routes, talk, server] = await Promise.all([
    readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8"),
    readFile(new URL("../../../packages/talk/api/routes.js", import.meta.url), "utf8"),
    readFile(new URL("../../../packages/talk/api/service.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.js", import.meta.url), "utf8")
  ]);
  const myReviewStart = core.indexOf("export async function getMySessionReview");
  const myReviewEnd = core.indexOf("\nexport async function ", myReviewStart + 1);
  assert.match(core.slice(myReviewStart, myReviewEnd), /authorTextReader\.find/);
  const publicReviewStart = core.indexOf("export async function listSessionReviews");
  const publicReviewEnd = core.indexOf("\nexport async function ", publicReviewStart + 1);
  assert.doesNotMatch(core.slice(publicReviewStart, publicReviewEnd), /authorTextReader|author_private/);

  assert.match(talk, /mergeAuthorChatView/);
  assert.match(talk, /create_session_message/);
  assert.match(talk, /update_session_pinned_message/);
  assert.match(routes, /moderatedTextHttpStatus\(moderated,/);
  assert.match(routes, /authorPrivateResponseHeaders/);
  assert.match(server, /authorTextReader: authorTextProjectionReader/);
});
