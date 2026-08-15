/**
 * CockroachDB Client — connection pool + query helpers.
 *
 * Boundary instrumentation (OTel): setiap operasi DB membungkus span `db.query`
 * dengan attribute semconv (db.system.name, db.operation.name) dan RED metric.
 * Ini satu titik instrumentasi untuk SEMUA handler — zero polusi di business logic.
 */

import { Pool } from "pg";
import { context, trace } from "@opentelemetry/api";
import {
  ATTR_DB_SYSTEM_NAME,
  ATTR_DB_OPERATION_NAME,
} from "@opentelemetry/semantic-conventions";
import { recordDbOperation } from "./telemetry";

export class CrdbClient {
  private pool: Pool | null = null;
  private connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.connectionString,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
      });
    }
    return this.pool;
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.traced("SELECT", sql, async (pool) => {
      const result = await pool.query(sql, params);
      return result.rows;
    });
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async execute(sql: string, params: any[] = []): Promise<void> {
    await this.traced("EXECUTE", sql, async (pool) => {
      await pool.query(sql, params);
    });
  }

  /** Execute DML and return the number of affected rows. */
  async executeCount(sql: string, params: any[] = []): Promise<number> {
    return this.traced("EXECUTE", sql, async (pool) => {
      const result = await pool.query(sql, params);
      return result.rowCount ?? 0;
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.queryOne("SELECT 1 as ok");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  /**
   * Wrapper terpusat: buat span `db.query` dari active context, jalankan fn,
   * catat duration metric. Panjang SQL dibatasi (tanpa nilai binding / PII).
   */
  private async traced<T>(
    operation: string,
    sql: string,
    fn: (pool: Pool) => Promise<T>,
  ): Promise<T> {
    const pool = this.getPool();
    const tracer = trace.getTracer("cbt-memory-agent-backend", "0.1.0");
    const parentCtx = context.active();
    const span = tracer.startSpan("db.query", { attributes: {} }, parentCtx);
    const startedAt = Date.now();
    const table = extractTable(sql);

    span.setAttribute(ATTR_DB_SYSTEM_NAME, "cockroachdb");
    span.setAttribute(ATTR_DB_OPERATION_NAME, operation.toLowerCase());
    if (table) span.setAttribute("db.sql.table", table);

    try {
      return await context.with(trace.setSpan(parentCtx, span), () => fn(pool));
    } catch (err) {
      span.setAttribute("db.response.status_code", "error");
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
      recordDbOperation(operation.toLowerCase(), Date.now() - startedAt);
    }
  }
}

/** Ekstrak nama tabel utama dari SQL — hanya untuk atribut (tanpa nilai). */
function extractTable(sql: string): string | null {
  const match = /(?:FROM|INTO|UPDATE|DELETE FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(sql);
  return match ? match[1] : null;
}
