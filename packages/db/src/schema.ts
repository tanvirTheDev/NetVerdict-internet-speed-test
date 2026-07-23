import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { BUFFERBLOAT_GRADES, DAY_BUCKETS } from '@netverdict/contracts';

/**
 * Plain, well-indexed Postgres tables on Neon — not a TimescaleDB
 * hypertable. No free/serverless Postgres host supports the extension;
 * see `docs/adr/0004-neon-over-timescale.md`. If the project later moves
 * to a self-hosted Postgres instance, converting `tests` to a hypertable
 * is a deliberate, documented migration — not assumed here.
 */

export const dayBucketEnum = pgEnum('day_bucket', DAY_BUCKETS);
export const bufferbloatGradeEnum = pgEnum('bufferbloat_grade', BUFFERBLOAT_GRADES);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    /** Logical reference only (no FK): avoids a circular constraint with `isp_plans.user_id`. Enforced at the service layer. */
    homeIspPlanId: uuid('home_isp_plan_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

export const ispPlans = pgTable(
  'isp_plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ispName: text('isp_name').notNull(),
    planName: text('plan_name').notNull(),
    advertisedDownMbps: real('advertised_down_mbps').notNull(),
    advertisedUpMbps: real('advertised_up_mbps').notNull(),
    /** Integer minor units (e.g. paisa/cents) — never a float for money (§2.10 of the build brief). */
    monthlyPrice: integer('monthly_price').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('isp_plans_user_id_idx').on(table.userId)],
);

export const tests = pgTable(
  'tests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Nullable: anonymous testing is a first-class product requirement (§10 Privacy). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    planId: uuid('plan_id').references(() => ispPlans.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    tzOffsetMinutes: integer('tz_offset_minutes').notNull(),
    dayBucket: dayBucketEnum('day_bucket').notNull(),

    // Nullable, not zero: a missing measurement must never render as "0 Mbps" (§5.7 rule 1/6).
    downMbps: real('down_mbps'),
    upMbps: real('up_mbps'),
    idleLatencyMs: real('idle_latency_ms'),
    loadedLatencyDownMs: real('loaded_latency_down_ms'),
    loadedLatencyUpMs: real('loaded_latency_up_ms'),
    jitterMs: real('jitter_ms'),
    packetLossPct: real('packet_loss_pct'),
    bufferbloatGradeDown: bufferbloatGradeEnum('bufferbloat_grade_down'),
    bufferbloatGradeUp: bufferbloatGradeEnum('bufferbloat_grade_up'),
    /** Headline (loaded) RPM figure. The idle/down/up breakdown lives in `clientMeta` until a dedicated column earns its keep. */
    rpm: real('rpm'),

    endpoint: text('endpoint').notNull(),
    connectionType: text('connection_type').notNull(),
    clientMeta: jsonb('client_meta').notNull().default({}),

    isPartial: boolean('is_partial').notNull().default(false),
    anomalyFlag: boolean('anomaly_flag').notNull().default(false),

    schemaVersion: integer('schema_version').notNull(),
    engineVersion: text('engine_version').notNull(),
    gradingProfile: text('grading_profile').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tests_user_id_started_at_idx').on(table.userId, table.startedAt),
    index('tests_plan_id_day_bucket_idx').on(table.planId, table.dayBucket),
  ],
);

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** ≥128 bits of entropy, generated at the service layer — the DB only enforces uniqueness (§2.15). */
    publicSlug: text('public_slug').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rangeStart: timestamp('range_start', { withTimezone: true }).notNull(),
    rangeEnd: timestamp('range_end', { withTimezone: true }).notNull(),
    summary: jsonb('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('reports_public_slug_key').on(table.publicSlug)],
);
