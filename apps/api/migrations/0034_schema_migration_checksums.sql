ALTER TABLE schema_migrations
  ADD COLUMN checksum_sha256 CHAR(64) NULL AFTER version;
