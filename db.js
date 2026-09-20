// Postgres, when configured. The one dependency in the project (pg), because Cloud Run instances
// share nothing: the chronicle and the per-IP limit have to live somewhere every instance can see.
//
// Configuration is pg's own: DATABASE_URL, or PGHOST / PGUSER / PGPASSWORD / PGDATABASE. On Cloud Run
// PGHOST is the Cloud SQL socket directory (/cloudsql/<project>:<region>:<instance>). Nothing set
// means no database, and the callers fall back to memory or a local file.
//
// The schema is created on start; there is no migration tool. Columns hold what is filtered on
// (time, reign, mock); `record` is the whole turn as JSON, calls included, so any analysis can be
// done in SQL over the raw material.
import pg from 'pg';

export const enabled = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
let pool = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS turns (
  seq    bigserial PRIMARY KEY,
  id     uuid NOT NULL UNIQUE,
  t      timestamptz NOT NULL,
  reign  uuid,
  mock   boolean NOT NULL,
  record jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS turns_reign_idx ON turns (reign);
CREATE INDEX IF NOT EXISTS turns_t_idx ON turns (t);
-- One decision per reign and year, for records made against signed state (v >= 3). Older records
-- took the year from the client and may repeat it.
CREATE UNIQUE INDEX IF NOT EXISTS turns_reign_year_idx ON turns (reign, ((record->>'year')::int)) WHERE (record->>'v')::int >= 3;
CREATE TABLE IF NOT EXISTS day_hits (
  day    date PRIMARY KEY,
  hits   integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ip_hits (
  ip     text NOT NULL,
  minute bigint NOT NULL,
  hits   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, minute)
);
`;

export async function start() {
  if (!enabled) return null;
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    max: Number(process.env.PGPOOL_MAX || 5),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 60_000,
  });
  pool.on('error', (e) => console.error('Postgres pool:', e.message));
  // Fail loudly: a configured but unreachable database should stop the deploy, not run without the ledger.
  // Instances start together on Cloud Run, and concurrent CREATE TABLE IF NOT EXISTS races inside
  // Postgres (duplicate pg_type key), so the schema runs under an advisory lock.
  const client = await pool.connect().catch((e) => { throw new Error(`Postgres is configured but unreachable (${e.message}). Unset DATABASE_URL/PGHOST to run without it.`); });
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(3384870)');
    await client.query(SCHEMA);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error(`Postgres schema setup failed (${e.message}).`);
  } finally { client.release(); }
  setInterval(() => pool.query('DELETE FROM ip_hits WHERE minute < $1', [minute() - 2]).catch(() => {}), 60_000).unref();
  return pool;
}

export function query(text, params) {
  if (!pool) throw new Error('Postgres is not configured.');
  return pool.query(text, params);
}

const minute = () => Math.floor(Date.now() / 60_000);

// True when this IP has already used its allowance for the current minute, counted across all
// instances. Fails open: if the database is unreachable the caller's in-memory limit still applies.
export async function rateLimited(ip, limit) {
  const { rows } = await query(
    'INSERT INTO ip_hits (ip, minute, hits) VALUES ($1, $2, 1) ON CONFLICT (ip, minute) DO UPDATE SET hits = ip_hits.hits + 1 RETURNING hits',
    [ip, minute()],
  );
  return rows[0].hits > limit;
}

// True when the whole service has used its allowance of turns for the current UTC day.
export async function dayLimited(limit) {
  const { rows } = await query(
    "INSERT INTO day_hits (day, hits) VALUES ((now() AT TIME ZONE 'utc')::date, 1) ON CONFLICT (day) DO UPDATE SET hits = day_hits.hits + 1 RETURNING hits",
  );
  return rows[0].hits > limit;
}

export async function stop() {
  if (pool) await pool.end();
  pool = null;
}
