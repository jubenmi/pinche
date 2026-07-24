import assert from "node:assert/strict";
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

test("invite guard independently requires empty-token and network failure state", () => {
  assert.deepEqual(invitePreparationContractFailures(completeInvitePreparationSource), []);

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

test("invite guard requires begin and successful retry to clear stale failure state", () => {
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

test("Skyline guard accepts disabled flags but rejects a Skyline page renderer", () => {
  assert.equal(
    pagesUseSkylineRenderer({
      pages: [
        {
          path: "pages/session/share",
          style: { skylineRenderEnable: false }
        }
      ]
    }),
    false
  );
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
});
