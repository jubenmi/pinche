import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const albumPageUrl = new URL(
  "../src/pages/session/album.vue",
  import.meta.url,
);

async function albumPageSource() {
  return readFile(albumPageUrl, "utf8");
}

test("album picker derives keys from the safe three-kind DTO", async () => {
  const source = await albumPageSource();

  assert.match(source, /albumTagKey\(tag\)\s*\{/);
  assert.match(source, /const refId = Number\(tag\?\.ref_id\)/);
  assert.match(
    source,
    /tag\?\.kind === "role" && Number\.isSafeInteger\(refId\) && refId > 0[\s\S]*`role:\$\{refId\}`/,
  );
  assert.match(
    source,
    /tag\?\.kind === "npc_role" && Number\.isSafeInteger\(refId\) && refId > 0[\s\S]*`npc-role:\$\{refId\}`/,
  );
  assert.match(source, /tag\?\.kind === "other" \? "other" : ""/);
  assert.doesNotMatch(
    source,
    /dm:session|npc:session|organizer:session|other:session|session-npc:/,
  );
});

test("offline album tag fallback exposes every seat role, npc roles, and other without accounts", async () => {
  const source = await albumPageSource();
  const fallback = source.match(
    /sessionDetailPeople\(session\)\s*\{([\s\S]*?)\n    \},\n    mergePeople/,
  )?.[1] ?? "";

  assert.doesNotMatch(fallback, /seat\.status|\["confirmed", "locked"\]/);
  assert.match(fallback, /key: `role:\$\{refId\}`/);
  assert.match(fallback, /kind: "role"/);
  assert.match(fallback, /role\.status !== "active"/);
  assert.match(fallback, /key: `npc-role:\$\{refId\}`/);
  assert.match(fallback, /kind: "npc_role"/);
  assert.match(fallback, /key: "other"/);
  assert.match(fallback, /kind: "other"/);
  assert.doesNotMatch(
    fallback,
    /tag_type|user_id|confirmed_user|bound_user|nickname|open_id|account|dm_user|npc_user/,
  );
});

test("album tag filtering and selection derive photo keys from kind and ref_id", async () => {
  const source = await albumPageSource();

  assert.match(
    source,
    /selectedTagKeys = \(photo\.tags \|\| \[\]\)\s*\.map\(\(tag\) => this\.albumTagKey\(tag\)\)\s*\.filter\(Boolean\)/,
  );
  assert.match(
    source,
    /photo\.tags \|\| \[\]\)\.some\(\(tag\) => this\.albumTagKey\(tag\) === roleKey\)/,
  );
  assert.doesNotMatch(source, /tag\.user_id|tag\.tag_type|person\.tag_type/);
});
