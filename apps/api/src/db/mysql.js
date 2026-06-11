import mysql from "mysql2/promise";
import { config } from "../config/env.js";

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
