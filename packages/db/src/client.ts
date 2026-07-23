import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

/**
 * Connection string is a parameter, never `process.env` read here — the
 * one place that reads env is the app's typed config module (§2.6). This
 * keeps `@netverdict/db` importable from a test without a real database.
 */
export function createDb(connectionString: string) {
  const sql = neon(connectionString);
  return drizzle({ client: sql, schema });
}
