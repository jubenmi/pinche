-- D46 author-private visibility columns, index, and self-reference are
-- reconciled by prepareMigration in apps/api/src/modules/album-video/migration.js
-- before this migration is recorded. MySQL/TDSQL-C DDL commits independently,
-- so reconciliation is intentionally shape-checked and safe to rerun.
SELECT 1;
