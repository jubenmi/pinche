import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  fixedClaimImageFailures,
  invitePreparationContractFailures,
  jpegDimensions,
  pagesUseSkylineRenderer
} from "./d56-unified-session-share-check.js";

function jpegFixture({ width, height, marker = 0xc0 }) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, marker,
    0x00, 0x11,
    0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
}

const completeInvitePreparationSource = `
  async prepareJoinInviteToken() {
    this.invitePreparing = true;
    this.invitePrepareError = false;
    try {
      const response = await request();
      this.inviteToken = dataOf(response)?.token || "";
      if (!this.inviteToken) {
        this.invitePrepareError = true;
        this.statusText = "分享准备失败，请重试。";
      }
    } catch (error) {
      this.inviteToken = "";
      this.invitePrepareError = true;
      this.statusText = "分享准备失败，请重试。";
    } finally {
      this.invitePreparing = false;
    }
  },
  async retryPrepareInvite() {
    this.invitePrepareError = false;
    this.statusText = "";
    await this.prepareJoinInviteToken();
    if (this.inviteToken) {
      this.invitePrepareError = false;
      this.statusText = "";
    }
  }
`;

test("invite guard accepts the complete preparation and retry contract", () => {
  assert.deepEqual(invitePreparationContractFailures(completeInvitePreparationSource), []);
});

test("invite guard requires the empty-token failure assignment", () => {
  const missingEmptyTokenAssignment = completeInvitePreparationSource.replace(
    `      if (!this.inviteToken) {
        this.invitePrepareError = true;
        this.statusText = "分享准备失败，请重试。";
      }`,
    `      if (!this.inviteToken) {
        this.statusText = "分享准备失败，请重试。";
      }`
  );
  assert.match(
    invitePreparationContractFailures(missingEmptyTokenAssignment).join("\n"),
    /empty-token response/
  );
});

test("invite guard independently requires the network catch assignment", () => {
  const missingCatchAssignment = completeInvitePreparationSource.replace(
    `      this.inviteToken = "";
      this.invitePrepareError = true;
      this.statusText = "分享准备失败，请重试。";`,
    `      this.inviteToken = "";
      this.statusText = "分享准备失败，请重试。";`
  );
  assert.match(
    invitePreparationContractFailures(missingCatchAssignment).join("\n"),
    /network catch/
  );
});

test("invite guard requires preparation start to clear stale failure state", () => {
  const missingPrepareStartClear = completeInvitePreparationSource.replace(
    `    this.invitePreparing = true;
    this.invitePrepareError = false;`,
    `    this.invitePreparing = true;`
  );
  assert.match(
    invitePreparationContractFailures(missingPrepareStartClear).join("\n"),
    /preparation begin/
  );
});

test("invite guard requires retry start to clear stale failure state", () => {
  const missingRetryStartClear = completeInvitePreparationSource.replace(
    `  async retryPrepareInvite() {
    this.invitePrepareError = false;
    this.statusText = "";`,
    `  async retryPrepareInvite() {
    this.statusText = "";`
  );
  assert.match(
    invitePreparationContractFailures(missingRetryStartClear).join("\n"),
    /retry begin/
  );
});

test("invite guard requires successful retry to clear stale failure state", () => {
  const missingSuccessClear = completeInvitePreparationSource.replace(
    `    if (this.inviteToken) {
      this.invitePrepareError = false;
      this.statusText = "";
    }`,
    `    if (this.inviteToken) {
      this.statusText = "";
    }`
  );
  assert.match(
    invitePreparationContractFailures(missingSuccessClear).join("\n"),
    /successful retry/
  );
});

test("JPEG parser reads baseline and progressive SOF dimensions", () => {
  assert.deepEqual(jpegDimensions(jpegFixture({ width: 560, height: 448 })), {
    width: 560,
    height: 448
  });
  assert.deepEqual(
    jpegDimensions(jpegFixture({ width: 1000, height: 800, marker: 0xc2 })),
    { width: 1000, height: 800 }
  );
});

test("fixed image guard rejects non-JPEG bytes and the wrong aspect ratio", () => {
  assert.match(
    fixedClaimImageFailures(Buffer.from("not a jpeg")).join("\n"),
    /valid JPEG/
  );
  assert.match(
    fixedClaimImageFailures(jpegFixture({ width: 560, height: 449 })).join("\n"),
    /5:4/
  );
  assert.deepEqual(
    fixedClaimImageFailures(jpegFixture({ width: 560, height: 448 })),
    []
  );
});

test("Skyline guard accepts disabled flags and unrelated text", () => {
  assert.equal(
    pagesUseSkylineRenderer({
      description: "Skyline is not enabled here",
      pages: [
        {
          path: "pages/session/share",
          style: {
            skylineRenderEnable: false,
            note: "mentions Skyline without selecting a renderer"
          }
        }
      ]
    }),
    false
  );
});

test("Skyline guard rejects top-level, global, and subpackage renderer selections", () => {
  assert.equal(
    pagesUseSkylineRenderer({
      pages: [
        {
          path: "pages/session/share",
          style: { renderer: "SkyLine" }
        }
      ]
    }),
    true
  );
  assert.equal(
    pagesUseSkylineRenderer({
      globalStyle: { renderer: "skyline" },
      pages: []
    }),
    true
  );
  assert.equal(
    pagesUseSkylineRenderer({
      pages: [],
      subPackages: [
        {
          root: "feature",
          pages: [
            {
              path: "share",
              style: { renderer: "SKYLINE" }
            }
          ]
        }
      ]
    }),
    true
  );
});

test("Skyline guard rejects skylineRenderEnable true anywhere", () => {
  assert.equal(
    pagesUseSkylineRenderer({
      pages: [],
      settings: {
        nested: [{ skylineRenderEnable: true }]
      }
    }),
    true
  );
});

test("importing D56 helpers does not execute the repository integration check", () => {
  const checkerUrl = new URL("./d56-unified-session-share-check.js", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(checkerUrl)});`
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});
