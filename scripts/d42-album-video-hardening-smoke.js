import { fileURLToPath } from "node:url";

const LOCAL_MYSQL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertD42SmokeIsolation(env) {
  const source = env || {};
  const failures = [];
  if (source.NODE_ENV === "production") {
    failures.push("NODE_ENV must not be production");
  }
  if (source.WECHAT_MOCK_LOGIN !== "true") {
    failures.push("WECHAT_MOCK_LOGIN must equal true");
  }
  if (source.D42_SMOKE_ISOLATED !== "1") {
    failures.push("D42_SMOKE_ISOLATED must equal 1");
  }
  if (!LOCAL_MYSQL_HOSTS.has(String(source.MYSQL_HOST || "").trim().toLowerCase())) {
    failures.push("MYSQL_HOST must be localhost, 127.0.0.1, or ::1");
  }
  if (source.MYSQL_DATABASE !== "pinche_d42_test") {
    failures.push("MYSQL_DATABASE must equal pinche_d42_test");
  }
  if (failures.length > 0) {
    throw new Error(`D42 smoke isolation rejected before imports/API/database: ${failures.join("; ")}`);
  }
  return true;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  if (!process.argv.slice(2).includes("--run")) {
    console.log("D42 smoke skipped (pass --run with the isolated test environment to execute)");
  } else {
    assertD42SmokeIsolation(process.env);
    console.log("D42 smoke isolation gate passed; persistent scenarios are enabled for pinche_d42_test");
  }
}
