/**
 * CockroachDB Client — connection pool + query helpers.
 */

import { Pool, PoolClient } from "pg";

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
    const pool = this.getPool();
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async execute(sql: string, params: any[] = []): Promise<void> {
    const pool = this.getPool();
    await pool.query(sql, params);
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
}
