import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/pages/admin/catalog.vue", import.meta.url),
  "utf8"
);

function functionSource(name, nextName) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const boundaries = [
    source.indexOf(`\nasync function ${nextName}(`, start),
    source.indexOf(`\nfunction ${nextName}(`, start)
  ].filter((index) => index >= 0);
  const end = Math.min(...boundaries);
  assert.notEqual(end, -1, `missing boundary ${nextName}`);
  return source.slice(start, end);
}

test("overlapping admin operations keep the shared loading state active", () => {
  assert.match(source, /const loadingOperationCount = ref\(0\)/);
  const withLoading = functionSource("withLoading", "refreshAll");
  assert.match(withLoading, /loadingOperationCount\.value \+= 1/);
  assert.match(withLoading, /loadingOperationCount\.value = Math\.max\(/);
  assert.match(withLoading, /loading\.value = loadingOperationCount\.value > 0/);
});

test("admin catalog lists accept only the newest filter response", () => {
  for (const [kind, nextName] of [
    ["Stores", "resetStoreForm"],
    ["Scripts", "resetScriptForm"],
    ["Requests", "itemTypeLabel"]
  ]) {
    assert.match(source, new RegExp(`const ${kind[0].toLowerCase()}${kind.slice(1, -1)}LoadSerial = ref\\(0\\)`));
    const load = functionSource(`load${kind}`, nextName);
    const serialName = `${kind[0].toLowerCase()}${kind.slice(1, -1)}LoadSerial`;
    assert.match(load, new RegExp(`const serial = ${serialName}\\.value \\+ 1`));
    assert.match(load, new RegExp(`${serialName}\\.value = serial`));
    assert.match(load, new RegExp(`serial !== ${serialName}\\.value`));
  }
});
