import mysql from "mysql2/promise";
import { config } from "../config/env.js";

export const requiredSchemaTables = Object.freeze([
  "schema_migrations",
  "users",
  "user_roles",
  "stores",
  "scripts",
  "admin_web_login_tickets",
  "store_scripts"
]);

export function serverConnectionOptions() {
  return {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    multipleStatements: false
  };
}

export function databaseConnectionOptions() {
  return {
    ...serverConnectionOptions(),
    database: config.mysql.database
  };
}

export async function createServerConnection() {
  return mysql.createConnection(serverConnectionOptions());
}

export async function createDatabaseConnection() {
  return mysql.createConnection(databaseConnectionOptions());
}

export async function withDatabaseConnection(work) {
  const connection = await createDatabaseConnection();
  try {
    return await work(connection);
  } finally {
    await connection.end();
  }
}

export async function withTransaction(work) {
  return withDatabaseConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function checkDatabaseConnection() {
  const connection = await createDatabaseConnection();
  try {
    const [rows] = await connection.query("SELECT 1 AS ok");
    return rows[0]?.ok === 1;
  } finally {
    await connection.end();
  }
}

export async function checkDatabaseReadiness() {
  const connection = await createDatabaseConnection();
  try {
    const [connectionRows] = await connection.query("SELECT 1 AS ok");
    const connected = connectionRows[0]?.ok === 1;
    if (!connected) {
      return {
        ok: false,
        connected: false,
        schemaReady: false,
        missingTables: requiredSchemaTables
      };
    }

    const [tableRows] = await connection.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN (?)
      `,
      [requiredSchemaTables]
    );
    const existingTables = new Set(tableRows.map((row) => row.TABLE_NAME || row.table_name));
    const missingTables = requiredSchemaTables.filter((table) => !existingTables.has(table));

    return {
      ok: missingTables.length === 0,
      connected: true,
      schemaReady: missingTables.length === 0,
      missingTables
    };
  } catch (error) {
    return {
      ok: false,
      connected: false,
      schemaReady: false,
      missingTables: [],
      error: error.message
    };
  } finally {
    await connection.end();
  }
}
