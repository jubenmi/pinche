import assert from "node:assert/strict";
import test from "node:test";

import {
  assertUserImageCleanupPath,
  runUserImageCleanupBatch
} from "../src/modules/user-image-assets/cleanup.js";
import {
  claimUserImageCleanupJobs,
  completeUserImageCleanup,
  failUserImageCleanup,
  prepareUserImageCleanupDeletion,
  protectUserImageUploadCleanup,
  scheduleUserImageAssetCleanup
} from "../src/modules/user-image-assets/repository.js";
import * as userImageRepository from "../src/modules/user-image-assets/repository.js";

test("finalize binds its asset while leaving unattached cleanup scheduled", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [{ affectedRows: 1 }];
    }
  };
  await protectUserImageUploadCleanup(connection, {
    ownerUserId: 7,
    path: "/uploads/avatars/user-7.jpg",
    assetId: 31
  });
  assert.match(calls[0].sql, /user_image_asset_id = \?/);
  assert.match(calls[0].sql, /status = 'pending'/);
  assert.match(calls[0].sql, /'leased'/);
  assert.doesNotMatch(calls[0].sql, /'deleting'/);
  assert.doesNotMatch(calls[0].sql, /completed_at = CURRENT_TIMESTAMP|status = 'retained'/);
});

test("cleanup accepts only controlled avatar and review paths", () => {
  assert.equal(assertUserImageCleanupPath("/uploads/avatars/user-7.jpg"), "/uploads/avatars/user-7.jpg");
  assert.equal(
    assertUserImageCleanupPath("/uploads/session-reviews/review-7.png"),
    "/uploads/session-reviews/review-7.png"
  );
  for (const path of ["/uploads/session-album/x.jpg", "/uploads/avatars/../x", "/etc/passwd"]) {
    assert.throws(() => assertUserImageCleanupPath(path), { code: "USER_IMAGE_CLEANUP_PATH_INVALID" });
  }
});

function cleanupHarness({ referenced = false, deleteError = null, moderationStatus = "approved", prepareAction = null } = {}) {
  const calls = [];
  const prepareInputs = [];
  const row = {
    id: 5,
    user_image_asset_id: 31,
    owner_user_id: 7,
    asset_path: "/uploads/avatars/user-7.jpg",
    object_key: "uploads/avatars/user-7.jpg",
    storage_kind: "cos",
    moderation_status: moderationStatus,
    attempts: 0
  };
  const repository = {
    claimUserImageCleanupJobs: async () => [{ ...row }],
    prepareUserImageCleanupDeletion: async (_connection, input) => {
      calls.push(["prepare"]);
      prepareInputs.push(input);
      return prepareAction || (referenced ? { action: "retained" } : { action: "delete" });
    },
    userImageCleanupReferenceExists: async () => referenced,
    completeUserImageCleanup: async (_connection, input) => calls.push(["complete", input]),
    failUserImageCleanup: async (_connection, input) => calls.push(["fail", input])
  };
  return {
    calls,
    prepareInputs,
    repository,
    storage: {
      delete: async (key) => {
        calls.push(["delete", key]);
        if (deleteError) throw deleteError;
      }
    },
    withTransaction: async (run) => run({})
  };
}

test("cleanup rechecks references immediately before deleting", async () => {
  const harness = cleanupHarness({ referenced: true });
  await runUserImageCleanupBatch({ ...harness, randomUUID: () => "lease", now: () => 1000 });
  assert.deepEqual(harness.calls, [["prepare"]]);
});

test("cleanup deletes an unreferenced object and completes its durable job", async () => {
  const harness = cleanupHarness();
  await runUserImageCleanupBatch({ ...harness, randomUUID: () => "lease", now: () => 1000 });
  assert.deepEqual(harness.calls[0], ["prepare"]);
  assert.equal(harness.prepareInputs[0].assetId, 31);
  assert.equal(harness.prepareInputs[0].ownerUserId, 7);
  assert.equal(harness.prepareInputs[0].assetPath, "/uploads/avatars/user-7.jpg");
  assert.deepEqual(harness.calls[1], ["delete", "uploads/avatars/user-7.jpg"]);
  assert.deepEqual(harness.calls[2], ["complete", {
    jobId: 5,
    leaseToken: "lease",
    status: "cleaned"
  }]);
});

test("cleanup defers nonterminal moderation assets without touching storage", async () => {
  for (const moderationStatus of ["pending", "error", "review"]) {
    const harness = cleanupHarness({
      moderationStatus,
      prepareAction: { action: "deferred" }
    });
    await runUserImageCleanupBatch({ ...harness, randomUUID: () => "lease", now: () => 1000 });
    assert.deepEqual(harness.calls, [["prepare"]]);
  }
});

test("cleanup repository defers every nonterminal moderation asset before reference or deletion", async () => {
  for (const moderationStatus of ["pending", "error", "review"]) {
    const calls = [];
    const connection = {
      async query(sql, params) {
        const text = String(sql);
        calls.push({ sql: text, params });
        if (text.includes("SELECT * FROM user_image_asset_cleanup_jobs")) return [[{
          id: 5,
          user_image_asset_id: 31,
          owner_user_id: 7,
          asset_path: "/uploads/avatars/user-7.jpg"
        }]];
        if (text.includes("SELECT * FROM user_image_assets WHERE id")) return [[{
          id: 31,
          owner_user_id: 7,
          asset_path: "/uploads/avatars/user-7.jpg",
          status: "active",
          moderation_status: moderationStatus
        }]];
        return [{ affectedRows: 1 }];
      }
    };
    assert.deepEqual(await prepareUserImageCleanupDeletion(connection, {
      jobId: 5,
      leaseToken: "lease",
      deferUntil: new Date(1000),
      assetId: 31,
      ownerUserId: 7,
      assetPath: "/uploads/avatars/user-7.jpg"
    }), { action: "deferred" });
    assert.equal(calls.some((call) => call.sql.includes("AS business_referenced")), false);
    assert.equal(calls.some((call) => call.sql.includes("SET status = 'deleted'")), false);
    assert.match(calls.at(-1).sql, /SET status = 'retry'/);
  }
});

test("a tombstoned asset job becomes retained while one durable object cleanup watches its live sibling", async () => {
  const sharedPath = "/uploads/avatars/shared.jpg";
  const sharedKey = "uploads/avatars/shared.jpg";
  const assets = [
    { id: 31, owner_user_id: 7, asset_path: sharedPath, object_key: sharedKey, status: "active", moderation_status: "approved_legacy" },
    { id: 32, owner_user_id: 8, asset_path: sharedPath, object_key: sharedKey, status: "active", moderation_status: "approved_legacy" }
  ];
  const jobs = [
    { id: 5, user_image_asset_id: 31, owner_user_id: 7, asset_path: sharedPath, object_key: sharedKey, storage_kind: "cos" },
    { id: 6, user_image_asset_id: 32, owner_user_id: 8, asset_path: sharedPath, object_key: sharedKey, storage_kind: "cos" }
  ];
  const calls = [];
  const objectJobs = [];
  const connection = {
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("SELECT * FROM user_image_assets WHERE id")) {
        return [[assets.find((asset) => asset.id === Number(params[0]))]];
      }
      if (text.includes("SELECT * FROM user_image_asset_cleanup_jobs")) {
        return [[jobs.find((job) => job.id === Number(params[0]))]];
      }
      if (text.includes("AS business_referenced")) {
        assert.match(text, /AS physical_live/);
        const currentId = Number(params[2]);
        const otherLive = assets.some((asset) => asset.id !== currentId && asset.status === "active" &&
          (asset.asset_path === sharedPath || asset.object_key === sharedKey));
        return [[{ business_referenced: 0, physical_live: otherLive ? 1 : 0 }]];
      }
      if (text.includes("UPDATE user_image_assets SET status = 'deleted'")) {
        const asset = assets.find((entry) => entry.id === Number(params[0]));
        if (!asset || asset.status !== "active") return [{ affectedRows: 0 }];
        asset.status = "deleted";
        return [{ affectedRows: 1 }];
      }
      if (text.includes("INSERT INTO user_image_object_cleanup_jobs")) {
        if (objectJobs.length === 0) objectJobs.push({ storage_kind: "cos", object_key: sharedKey });
        return [{ affectedRows: 1, insertId: 1 }];
      }
      return [{ affectedRows: 1 }];
    }
  };
  assert.deepEqual(await prepareUserImageCleanupDeletion(connection, {
    jobId: 5,
    leaseToken: "lease",
    assetId: 31,
    ownerUserId: 7,
    assetPath: sharedPath,
    deferUntil: new Date(1000)
  }), { action: "retained" });
  assert.equal(assets[0].status, "deleted");
  assert.equal(assets[1].status, "active");
  assert.equal(objectJobs.length, 1);
  assert.match(calls.at(-1).sql, /SET status = 'retained'/);
});

function concurrentSharedObjectHarness() {
  const sharedPath = "/uploads/avatars/concurrent-shared.jpg";
  const sharedKey = "uploads/avatars/concurrent-shared.jpg";
  const assets = [
    { id: 41, owner_user_id: 7, asset_path: sharedPath, object_key: sharedKey, status: "active", moderation_status: "approved_legacy" },
    { id: 42, owner_user_id: 8, asset_path: sharedPath, object_key: sharedKey, status: "active", moderation_status: "approved_legacy" }
  ];
  const jobs = [
    { id: 15, user_image_asset_id: 41, owner_user_id: 7, asset_path: sharedPath, object_key: sharedKey, storage_kind: "cos", status: "leased", lease_token: "lease-a", attempts: 0 },
    { id: 16, user_image_asset_id: 42, owner_user_id: 8, asset_path: sharedPath, object_key: sharedKey, storage_kind: "cos", status: "leased", lease_token: "lease-b", attempts: 0 }
  ];
  let synchronizeReferences = true;
  let referenceCount = 0;
  let releaseReferences;
  const referencesReady = new Promise((resolve) => {
    releaseReferences = resolve;
  });
  const deletedKeys = [];
  const objectJobs = [];

  const connection = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("SELECT * FROM user_image_assets WHERE id")) {
        return [[assets.find((asset) => asset.id === Number(params[0]))]];
      }
      if (text.includes("ORDER BY created_at LIMIT")) {
        if (text.includes("user_image_object_cleanup_jobs")) {
          return [objectJobs.filter((job) => ["pending", "retry"].includes(job.status))
            .slice(0, Number(params[3]))];
        }
        return [jobs.filter((job) => job.status === "retry").slice(0, Number(params[3]))];
      }
      if (text.includes("FROM user_image_assets") && text.includes("ORDER BY id FOR UPDATE")) {
        return [[...assets].sort((left, right) => left.id - right.id)];
      }
      if (text.includes("SELECT * FROM user_image_object_cleanup_jobs")) {
        const job = objectJobs.find((entry) => entry.id === Number(params[0]));
        return [job?.status === "leased" && job.lease_token === String(params[1]) ? [job] : []];
      }
      if (text.includes("SELECT * FROM user_image_asset_cleanup_jobs")) {
        const job = jobs.find((entry) => entry.id === Number(params[0]));
        return [job?.status === "leased" && job.lease_token === String(params[1]) ? [job] : []];
      }
      if (text.includes("AS business_referenced")) {
        const currentId = Number(params[2]);
        const physicalLive = assets.some((asset) => asset.id !== currentId && asset.status === "active" &&
          (asset.asset_path === sharedPath || asset.object_key === sharedKey));
        if (synchronizeReferences) {
          referenceCount += 1;
          if (referenceCount === 2) releaseReferences();
          await referencesReady;
        }
        return [[{ business_referenced: 0, physical_live: physicalLive ? 1 : 0 }]];
      }
      if (text.includes("UPDATE user_image_assets SET status = 'deleted'")) {
        const asset = assets.find((entry) => entry.id === Number(params[0]));
        if (!asset || asset.status !== "active") return [{ affectedRows: 0 }];
        asset.status = "deleted";
        return [{ affectedRows: 1 }];
      }
      if (text.includes("INSERT INTO user_image_object_cleanup_jobs")) {
        let objectJob = objectJobs.find((entry) =>
          entry.storage_kind === String(params[2]) && entry.object_key === String(params[1])
        );
        if (!objectJob) {
          objectJob = {
            id: 25,
            asset_path: String(params[0]),
            object_key: String(params[1]),
            storage_kind: String(params[2]),
            status: "pending",
            attempts: 0
          };
          objectJobs.push(objectJob);
        }
        return [{ affectedRows: 1, insertId: objectJob.id }];
      }
      if (text.includes("SET status = 'retry'")) {
        const job = jobs.find((entry) => params.includes(entry.id));
        job.status = "retry";
        job.lease_token = null;
        return [{ affectedRows: 1 }];
      }
      if (text.includes("SET status = 'retained'")) {
        const job = jobs.find((entry) => params.includes(entry.id));
        job.status = "retained";
        job.lease_token = null;
        return [{ affectedRows: 1 }];
      }
      if (text.includes("SET status = 'leased', lease_token")) {
        const collection = text.includes("user_image_object_cleanup_jobs") ? objectJobs : jobs;
        const job = collection.find((entry) => entry.id === Number(params[2]));
        job.status = "leased";
        job.lease_token = String(params[0]);
        return [{ affectedRows: 1 }];
      }
      if (text.includes("SET status = 'deleting'")) {
        const collection = text.includes("user_image_object_cleanup_jobs") ? objectJobs : jobs;
        const job = collection.find((entry) => entry.id === Number(params[0]));
        job.status = "deleting";
        return [{ affectedRows: 1 }];
      }
      if (text.includes("SET status = ?, completed_at")) {
        const collection = text.includes("user_image_object_cleanup_jobs") ? objectJobs : jobs;
        const job = collection.find((entry) => entry.id === Number(params[1]));
        job.status = String(params[0]);
        job.lease_token = null;
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    }
  };

  async function tombstoneConcurrently() {
    const results = await Promise.all(jobs.map((job) => prepareUserImageCleanupDeletion(connection, {
      jobId: job.id,
      leaseToken: job.lease_token,
      assetId: job.user_image_asset_id,
      ownerUserId: job.owner_user_id,
      assetPath: job.asset_path,
      deferUntil: new Date(300_000)
    })));
    synchronizeReferences = false;
    return results;
  }

  return {
    assets,
    jobs,
    objectJobs,
    deletedKeys,
    tombstoneConcurrently,
    repository: {
      claimUserImageCleanupJobs,
      prepareUserImageCleanupDeletion,
      completeUserImageCleanup,
      failUserImageCleanup,
      claimUserImageObjectCleanupJobs: userImageRepository.claimUserImageObjectCleanupJobs,
      prepareUserImageObjectCleanupDeletion: userImageRepository.prepareUserImageObjectCleanupDeletion,
      completeUserImageObjectCleanup: userImageRepository.completeUserImageObjectCleanup,
      failUserImageObjectCleanup: userImageRepository.failUserImageObjectCleanup
    },
    storage: { delete: async (key) => deletedKeys.push(key) },
    withTransaction: async (run) => run(connection)
  };
}

test("concurrent shared-object workers retain both asset jobs and elect one durable object cleanup", async () => {
  const harness = concurrentSharedObjectHarness();

  assert.deepEqual(await harness.tombstoneConcurrently(), [
    { action: "retained" },
    { action: "retained" }
  ]);
  assert.deepEqual(harness.assets.map((asset) => asset.status), ["deleted", "deleted"]);
  assert.deepEqual(harness.jobs.map((job) => job.status), ["retained", "retained"]);
  assert.equal(harness.objectJobs.length, 1);
  assert.deepEqual(harness.deletedKeys, []);
});

test("a later claim reclaims shared bytes after concurrent workers tombstone the final live assets", async () => {
  const harness = concurrentSharedObjectHarness();
  await harness.tombstoneConcurrently();
  assert.deepEqual(harness.jobs.map((job) => job.status), ["retained", "retained"]);

  assert.deepEqual(await runUserImageCleanupBatch({
    ...harness,
    randomUUID: () => "recovery-lease",
    now: () => 600_000,
    limit: 1
  }), { claimed: 1 });

  assert.deepEqual(harness.deletedKeys, ["uploads/avatars/concurrent-shared.jpg"]);
  assert.equal(harness.objectJobs.some((job) => job.status === "cleaned"), true);
  assert.equal(harness.assets.some((asset) => asset.status === "active"), false);
});

test("the elected object cleanup stays durable without deleting a permanently live sibling", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("FROM user_image_assets")) {
        return [[{ id: 32, status: "active" }]];
      }
      if (text.includes("SELECT * FROM user_image_object_cleanup_jobs")) {
        return [[{
          id: 25,
          asset_path: "/uploads/avatars/shared.jpg",
          object_key: "uploads/avatars/shared.jpg",
          storage_kind: "cos"
        }]];
      }
      return [{ affectedRows: 1 }];
    }
  };
  assert.deepEqual(await userImageRepository.prepareUserImageObjectCleanupDeletion(connection, {
    jobId: 25,
    leaseToken: "object-lease",
    assetPath: "/uploads/avatars/shared.jpg",
    objectKey: "uploads/avatars/shared.jpg",
    storageKind: "cos",
    deferUntil: new Date(300_000)
  }), { action: "deferred" });
  assert.match(calls[0].sql, /FROM user_image_assets/);
  assert.match(calls[0].sql, /ORDER BY id FOR UPDATE/);
  assert.match(calls[1].sql, /FROM user_image_object_cleanup_jobs/);
  assert.match(calls.at(-1).sql, /SET status = 'retry'/);
  assert.equal(calls.some((call) => call.sql.includes("SET status = 'deleting'")), false);
});

test("cleanup deletion decision is committed before storage I/O", async () => {
  const harness = cleanupHarness({ moderationStatus: "rejected" });
  await runUserImageCleanupBatch({ ...harness, randomUUID: () => "lease", now: () => 1000 });
  assert.deepEqual(harness.calls.slice(0, 2), [
    ["prepare"],
    ["delete", "uploads/avatars/user-7.jpg"]
  ]);
});

test("scheduling a displaced historical asset atomically creates a missing cleanup anchor", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [{ affectedRows: 1, insertId: 9 }];
    }
  };
  await scheduleUserImageAssetCleanup(connection, {
    assetId: 31,
    storageKind: "cos",
    cleanupNotBefore: new Date(1000)
  });
  assert.match(calls[0].sql, /INSERT INTO user_image_asset_cleanup_jobs/);
  assert.match(calls[0].sql, /SELECT asset\.id, asset\.owner_user_id/);
  assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(calls[0].params.includes("cos"), true);
});

test("cleanup never holds its job lock while waiting for the common asset lock", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("SELECT * FROM user_image_asset_cleanup_jobs")) return [[{
        id: 5,
        user_image_asset_id: 31,
        owner_user_id: 7,
        asset_path: "/uploads/avatars/user-7.jpg"
      }]];
      if (text.includes("SELECT * FROM user_image_assets WHERE id")) return [[{
        id: 31,
        owner_user_id: 7,
        asset_path: "/uploads/avatars/user-7.jpg",
        status: "active",
        moderation_status: "rejected"
      }]];
      if (text.includes("AS business_referenced")) {
        return [[{ business_referenced: 0, physical_live: 0 }]];
      }
      return [{ affectedRows: 1 }];
    }
  };
  assert.deepEqual(await prepareUserImageCleanupDeletion(connection, {
    jobId: 5,
    leaseToken: "lease",
    deferUntil: new Date(1000),
    assetId: 31,
    ownerUserId: 7,
    assetPath: "/uploads/avatars/user-7.jpg"
  }), { action: "delete" });
  assert.match(calls[0].sql, /FROM user_image_assets WHERE id = \?/);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.match(calls[1].sql, /status = 'leased' AND lease_token = \?/);
  assert.match(calls[1].sql, /FOR UPDATE/);
  assert.match(calls[2].sql, /AS business_referenced/);
  assert.match(calls[3].sql, /UPDATE user_image_assets SET status = 'deleted'/);
  assert.deepEqual(calls[3].params, [31]);
  assert.match(calls[4].sql, /SET status = 'deleting'/);
});

test("cleanup completion only closes a previously committed deletion decision", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [{ affectedRows: 1 }];
    }
  };
  assert.equal(await completeUserImageCleanup(connection, {
    jobId: 5,
    leaseToken: "lease",
    status: "cleaned"
  }), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /status = 'deleting' AND lease_token = \?/);
  assert.doesNotMatch(calls[0].sql, /UPDATE user_image_assets/);
});

test("cleanup failure keeps the durable retry anchor", async () => {
  const harness = cleanupHarness({ deleteError: Object.assign(new Error("down"), { code: "COS_DOWN" }) });
  await runUserImageCleanupBatch({ ...harness, randomUUID: () => "lease", now: () => 1000 });
  assert.equal(harness.calls.at(-1)[0], "fail");
  assert.equal(harness.calls.at(-1)[1].jobId, 5);
  assert.equal(harness.calls.at(-1)[1].errorCode, "COS_DOWN");
  assert.equal(harness.calls.at(-1)[1].attempts, 1);
});

test("an expired committed deletion is reclaimable after a worker crash", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [[]];
    }
  };
  await claimUserImageCleanupJobs(connection, {
    leaseToken: "next-lease",
    now: new Date(1000),
    leaseExpiresAt: new Date(61_000),
    limit: 25
  });
  assert.match(calls[0].sql, /status IN \('leased', 'deleting'\)/);
});

test("an expired committed object deletion is reclaimable after a worker crash", async () => {
  assert.equal(typeof userImageRepository.claimUserImageObjectCleanupJobs, "function");
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [[]];
    }
  };
  await userImageRepository.claimUserImageObjectCleanupJobs(connection, {
    leaseToken: "next-object-lease",
    now: new Date(1000),
    leaseExpiresAt: new Date(61_000),
    limit: 25
  });
  assert.match(calls[0].sql, /user_image_object_cleanup_jobs/);
  assert.match(calls[0].sql, /status IN \('leased', 'deleting'\)/);
});

test("storage failure can move a committed deletion decision back to retry", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [{ affectedRows: 1 }];
    }
  };
  assert.equal(await failUserImageCleanup(connection, {
    jobId: 5,
    leaseToken: "lease",
    attempts: 1,
    nextRetryAt: new Date(1000),
    errorCode: "COS_DOWN"
  }), true);
  assert.match(calls[0].sql, /status IN \('leased', 'deleting'\)/);
});
