const SAFE_SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function albumMediaCountSql(alias) {
  const tableAlias = String(alias || "").trim();
  if (!SAFE_SQL_IDENTIFIER.test(tableAlias)) {
    throw new TypeError("album media alias must be a safe SQL identifier");
  }
  return (
    `COUNT(DISTINCT CASE WHEN ${tableAlias}.status = 'active' ` +
    `AND (${tableAlias}.media_type = 'image' OR ` +
    `(${tableAlias}.media_type = 'video' AND ${tableAlias}.processing_status <> 'failed')) ` +
    `THEN ${tableAlias}.id END)`
  );
}
