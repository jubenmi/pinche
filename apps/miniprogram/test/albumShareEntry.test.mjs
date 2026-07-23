import assert from "node:assert/strict";
import test from "node:test";

import {
  ALBUM_SHARE_INTENT,
  albumShareAppMessageIntent,
  createAlbumShareEntryAuthority,
  createAlbumShareEntryCoordinator,
  recruitmentSharePayload
} from "../src/utils/albumShareEntry.js";

test("album share app-message intent uses the documented source priority", () => {
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { albumShare: "recruit", mediaId: "41" } }
    }),
    { kind: ALBUM_SHARE_INTENT.RECRUIT }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { albumShare: "active", mediaId: "41" } }
    }),
    { kind: ALBUM_SHARE_INTENT.ACTIVE }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { mediaId: "41" } }
    }),
    { kind: ALBUM_SHARE_INTENT.SINGLE, mediaId: 41 }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { mediaId: "0" } }
    }),
    { kind: ALBUM_SHARE_INTENT.UNKNOWN }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { mediaId: "1.5" } }
    }),
    { kind: ALBUM_SHARE_INTENT.UNKNOWN }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({ from: "button", target: { dataset: {} } }),
    { kind: ALBUM_SHARE_INTENT.UNKNOWN }
  );
  assert.deepEqual(albumShareAppMessageIntent({ from: "menu" }), {
    kind: ALBUM_SHARE_INTENT.DEFAULT_ALL
  });
  assert.deepEqual(
    albumShareAppMessageIntent({ from: "menu" }, { timelineMode: true }),
    { kind: ALBUM_SHARE_INTENT.PUBLIC }
  );
});

test("recruitment share payload encodes the invite card and injects its timestamp", () => {
  assert.deepEqual(
    recruitmentSharePayload({
      sessionId: 123,
      inviteToken: "invite token",
      title: "剧本｜店家｜时间",
      now: 1720000000000
    }),
    {
      title: "剧本｜店家｜时间",
      path: "/pages/session/share?id=123&shareCode=s123-1720000000000&inviteToken=invite%20token&source=wechat_share",
      imageUrl: "/static/art/ticket-landscape.jpg"
    }
  );
});

test("recruitment share payload fails closed without a valid session, token, or title", () => {
  for (const payload of [
    { sessionId: 0, inviteToken: "invite", title: "title" },
    { sessionId: 123, inviteToken: "", title: "title" },
    { sessionId: 123, inviteToken: "invite", title: "   " }
  ]) {
    assert.equal(recruitmentSharePayload(payload), null);
  }
});

test("album share entry authority reuses its current key and invalidates stale requests", () => {
  const authority = createAlbumShareEntryAuthority();
  const first = authority.begin({ sessionId: 1, userId: 2, mediaVersion: 3 });
  const reused = authority.begin({ sessionId: 1, userId: 2, mediaVersion: 3 });

  assert.equal(reused.key, first.key);
  assert.equal(reused, first);
  assert.equal(authority.isCurrent(first), true);

  const changed = authority.begin({ sessionId: 1, userId: 2, mediaVersion: 4 });
  assert.notEqual(changed, first);
  assert.equal(authority.isCurrent(first), false);
  assert.equal(authority.isCurrent(changed), true);

  authority.invalidate();
  assert.equal(authority.isCurrent(changed), false);
});

test("album share entry authority fails closed for invalid identity without displacing the current request", () => {
  const authority = createAlbumShareEntryAuthority();
  const valid = authority.begin({ sessionId: 1, userId: 2, mediaVersion: 3 });
  const invalid = authority.begin({ sessionId: 0, userId: 0, mediaVersion: 0 });

  assert.equal(invalid, null);
  assert.equal(authority.isCurrent(invalid), false);
  assert.equal(authority.isCurrent(valid), true);
});

test("album share entry coordinator runs renderer jobs strictly in order", async () => {
  const coordinator = createAlbumShareEntryCoordinator();
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = coordinator.enqueue(async () => {
    order.push("startA");
    await firstGate;
    order.push("endA");
  });
  const second = coordinator.enqueue(async () => {
    order.push("startB");
    order.push("endB");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["startA"]);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(order, ["startA", "endA", "startB", "endB"]);
});

test("album share entry coordinator invalidates a running job and skips stale queued renderers", async () => {
  const coordinator = createAlbumShareEntryCoordinator();
  const order = [];
  let releaseFirst;
  let isFirstCurrent;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = coordinator.enqueue(async ({ isCurrent }) => {
    isFirstCurrent = isCurrent;
    order.push("startA");
    await firstGate;
    order.push("endA");
  });
  const second = coordinator.enqueue(async () => {
    order.push("startB");
    order.push("endB");
  });

  await Promise.resolve();
  assert.equal(isFirstCurrent(), true);
  coordinator.invalidate();
  assert.equal(isFirstCurrent(), false);
  releaseFirst();
  await Promise.all([first, second]);
  await coordinator.whenIdle();

  assert.deepEqual(order, ["startA", "endA"]);
});
