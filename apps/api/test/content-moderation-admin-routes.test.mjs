import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("server delegates every administrator moderation route through the authenticated DTO boundary", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /createAdminModerationApi/);
  assert.match(server, /const adminModerationApi = createAdminModerationApi/);
  assert.match(server, /listJobs:\s*\(filters\)\s*=>\s*withDatabaseConnection/);
  assert.match(server, /getJob:\s*\(jobId\)\s*=>\s*withDatabaseConnection/);
  assert.match(server, /decide:\s*\(input\)\s*=>\s*contentModeration\.decideAsAdmin/);
  assert.match(server, /applyTextProposal:\s*applyApprovedTextProposal/);
  assert.match(server, /requireRole\(user, "system_admin"\)/);
  assert.match(server, /adminModerationApi\(\{[\s\S]*method: request\.method/);
  assert.match(server, /"cache-control": "private, no-store"/);
});

test("server never exposes a moderation storage key through its ordinary media endpoints", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const routeStart = server.indexOf("const adminModerationRoute = await adminModerationApi");
  const routeEnd = server.indexOf('if (request.method === "POST" && url.pathname === "/api/uploads/cos-intent")', routeStart);
  const route = server.slice(routeStart, routeEnd);

  assert.ok(routeStart > 0 && routeEnd > routeStart);
  assert.match(route, /jsonResponse\(response, adminModerationRoute\.statusCode/);
  assert.doesNotMatch(route, /object_key|source_url|display_url|cover_url|provider_job_id|lease_token/);
});
