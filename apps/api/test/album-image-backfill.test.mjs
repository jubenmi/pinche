import assert from "node:assert/strict";
import test from "node:test";

import { backfillAlbumImageObjectKeys } from "../src/modules/album-image/backfill.js";

test("backfill updates only exact COS candidates whose HEAD succeeds", async () => {
  const rows = [
    { id: 1, photo_url: "/uploads/session-album/display/present.jpg" },
    { id: 2, photo_url: "/uploads/session-album/display/missing.jpg" },
    { id: 3, photo_url: "https://evil.example/not-valid.jpg" }
  ];
  const updates = [];
  const repository = {
    listBackfillCandidates: async (_afterId) => rows,
    updateBackfilledObject: async (input) => { updates.push(input); return true; }
  };
  const result = await backfillAlbumImageObjectKeys({
    repository,
    storage: {
      head: async (key) => {
        if (key.endsWith("present.jpg")) return { etag: '"present-etag"' };
        throw Object.assign(new Error("missing"), { code: "COS_OBJECT_NOT_FOUND" });
      }
    },
    apply: true,
    pageSize: 10
  });
  assert.deepEqual(result, { scanned: 3, updated: 1, missing: 1, invalid: 1 });
  assert.deepEqual(updates, [{
    id: 1,
    objectKey: "uploads/session-album/display/present.jpg",
    objectEtag: "present-etag",
    photoUrl: "/uploads/session-album/display/present.jpg"
  }]);
});

test("report-only backfill performs HEAD but never updates", async () => {
  let updates = 0;
  const result = await backfillAlbumImageObjectKeys({
    repository: {
      listBackfillCandidates: async () => [{ id: 1, photo_url: "/uploads/session-album/display/a.jpg" }],
      updateBackfilledObject: async () => { updates += 1; }
    },
    storage: { head: async () => ({ etag: "e" }) },
    apply: false
  });
  assert.equal(result.updated, 0);
  assert.equal(updates, 0);
});
