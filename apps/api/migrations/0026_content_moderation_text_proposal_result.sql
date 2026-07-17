-- D45 text proposal result column is reconciled by prepareMigration in
-- apps/api/src/modules/album-video/migration.js before this migration is recorded.
-- The reconciliation is intentionally idempotent so a crash after MySQL DDL
-- can be rerun safely by the existing migration runner.
SELECT 1;
