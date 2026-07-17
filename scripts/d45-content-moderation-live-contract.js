/* D45 offline contract: source-locked, dependency-free preflight. */
const POLICY_ID = "d45.live-contract.preflight.v1";
const ISOLATED_API_BASE_URL = "https://d45-content-moderation-staging.invalid/contract";

const ALLOWED_LIVE_ENVIRONMENT_KEYS = new Set([
  "D45_LIVE_CONTRACT",
  "D45_LIVE_CONTRACT_CONFIRM",
  "D45_LIVE_API_BASE_URL",
  "D45_LIVE_SAFE_SAMPLE_ID",
  "D45_LIVE_SAFE_SAMPLE_NAME"
]);

const HARMLESS_SAMPLE_PAIRS = new Set([
  "d45-safe-text-001\u0000wechat-text-pass",
  "d45-safe-image-001\u0000wechat-image-pass",
  "d45-safe-video-001\u0000tencent-video-pass"
]);

function isApprovedPreflight(environment) {
  const hasUnsupportedLiveInput = Object.keys(environment).some((key) =>
    key.startsWith("D45_LIVE_") && !ALLOWED_LIVE_ENVIRONMENT_KEYS.has(key)
  );
  if (hasUnsupportedLiveInput) return false;
  if (environment.D45_LIVE_CONTRACT !== "staging") return false;
  if (environment.D45_LIVE_CONTRACT_CONFIRM !== "run") return false;
  if (environment.D45_LIVE_API_BASE_URL !== ISOLATED_API_BASE_URL) return false;

  const samplePair = `${environment.D45_LIVE_SAFE_SAMPLE_ID}\u0000${environment.D45_LIVE_SAFE_SAMPLE_NAME}`;
  return HARMLESS_SAMPLE_PAIRS.has(samplePair);
}

function main() {
  const startedAt = Date.now();
  let approved = false;

  try {
    approved = isApprovedPreflight(process.env);
  } catch {
    approved = false;
  }

  console.log(JSON.stringify({
    policy_id: POLICY_ID,
    outcome: approved ? "dry_run_deferred" : "rejected",
    elapsed_ms: Math.max(0, Date.now() - startedAt)
  }));
  process.exitCode = approved ? 0 : 1;
}

main();
