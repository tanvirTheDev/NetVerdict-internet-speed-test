import { z } from 'zod';

/**
 * The one typed config module (§2.6 of the build brief). `process.env` is
 * read exactly once, here — every other module imports `serverConfig`
 * instead of touching `process.env` directly.
 *
 * Database/Redis/Auth variables are optional for now: nothing in the
 * codebase consumes them yet (Phase 0/1 is engine-and-scaffold only).
 * They become `.min(1)` required once Phase 4 (persistence) and auth
 * actually wire them in — tightening this schema is itself the signal
 * that a phase now depends on that credential.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(1).optional(),
  AUTH_GOOGLE_ID: z.string().min(1).optional(),
  AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
});

function loadServerConfig() {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}

export const serverConfig = loadServerConfig();
export type ServerConfig = typeof serverConfig;
