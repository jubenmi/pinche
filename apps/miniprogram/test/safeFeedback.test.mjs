import assert from "node:assert/strict";
import test from "node:test";

const safeFeedbackModule = await import("../src/utils/safeFeedback.js").catch(() => ({}));

function gateway(options) {
  assert.equal(
    typeof safeFeedbackModule.createSafeFeedback,
    "function",
    "safe feedback gateway must be implemented"
  );
  return safeFeedbackModule.createSafeFeedback(options);
}

test("safe feedback prefers the TDesign provider", () => {
  const calls = [];
  const feedback = gateway({
    getPreferredFeedback: () => ({
      showModal(options) {
        calls.push(["preferred", options.title]);
      }
    }),
    getPlatformFeedback: () => ({
      showModal() {
        calls.push(["platform"]);
      }
    })
  });

  feedback.showModal({ title: "微信登录" });

  assert.deepEqual(calls, [["preferred", "微信登录"]]);
});

test("safe feedback falls back to the platform when the preferred module is unavailable", () => {
  const calls = [];
  const feedback = gateway({
    getPreferredFeedback: () => undefined,
    getPlatformFeedback: () => ({
      showToast(options) {
        calls.push(options.title);
      }
    })
  });

  assert.doesNotThrow(() => feedback.showToast({ title: "登录失败" }));
  assert.deepEqual(calls, ["登录失败"]);
});

test("safe feedback falls back when resolving the preferred provider throws", () => {
  let platformCalls = 0;
  const feedback = gateway({
    getPreferredFeedback() {
      throw new TypeError("broken production module");
    },
    getPlatformFeedback: () => ({
      showActionSheet() {
        platformCalls += 1;
      }
    })
  });

  assert.doesNotThrow(() => feedback.showActionSheet({ itemList: ["男", "女"] }));
  assert.equal(platformCalls, 1);
});

test("safe feedback reports an unavailable method without throwing", () => {
  const events = [];
  const feedback = gateway({
    getPreferredFeedback: () => undefined,
    getPlatformFeedback: () => null
  });

  assert.doesNotThrow(() =>
    feedback.showModal({
      fail(result) {
        events.push(["fail", result.errMsg]);
      },
      complete(result) {
        events.push(["complete", result.errMsg]);
      }
    })
  );
  assert.deepEqual(events, [
    ["fail", "showModal:fail unavailable"],
    ["complete", "showModal:fail unavailable"]
  ]);
});
