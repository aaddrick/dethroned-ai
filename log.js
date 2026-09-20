// Decision log: every turn the model plays, with the raw request and response of both calls.
//
// Memory holds a slim copy of every record (everything except `calls`) for the stats, plus the full
// record for the most recent LOG_RAW_MEMORY turns. The durable copy is Postgres when db.js is
// configured: each instance inserts its own turns and pulls the other instances' rows once a minute,
// so however many instances serve the game there is one chronicle. Without Postgres the full records
// go to a local JSONL file, which is enough for one process on a laptop.
//
//   LOG_DIR         directory for the local file when Postgres is off (default data/log; empty disables)
//   LOG_MAX         slim records kept in memory, oldest dropped (default 100000)
//   LOG_RAW_MEMORY  full records kept in memory (default 2000)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import * as db from './db.js';

const LOG_DIR = process.env.LOG_DIR === undefined ? 'data/log' : process.env.LOG_DIR;
const MAX = Number(process.env.LOG_MAX || 100_000);
const RAW_MAX = Number(process.env.LOG_RAW_MEMORY || 2000);
const REFRESH_MS = 60_000;
const BATCH = 2000;

export const records = [];   // slim, oldest first
const seen = new Set();
const rawCache = new Map();  // id -> full record, insertion ordered, capped at RAW_MAX
let filePath = null;
let file = null;             // local append stream
let lastSeq = 0;             // highest turns.seq ingested from Postgres
export const status = { store: 'memory', loaded: 0, errors: 0, lastError: null };

function slim(r) { const { calls, ...rest } = r; return rest; }

function ingest(r) {
  if (!r?.id || seen.has(r.id)) return false;
  seen.add(r.id);
  records.push(slim(r));
  if (r.calls) {
    rawCache.set(r.id, r);
    if (rawCache.size > RAW_MAX) rawCache.delete(rawCache.keys().next().value);
  }
  if (records.length > MAX) {
    for (const d of records.splice(0, records.length - MAX)) { seen.delete(d.id); rawCache.delete(d.id); }
  }
  return true;
}

function fail(where, e) { status.errors++; status.lastError = `${where}: ${e.message}`; console.error(`Decision log (${where}):`, e.message); }

// ---- Postgres ------------------------------------------------------------------

// Slim rows newer than what we have, oldest first. Rows this instance wrote are already in memory
// and are skipped by `ingest`; the point is the other instances' rows.
async function pull() {
  let n = 0;
  for (;;) {
    const { rows } = await db.query('SELECT seq, record - $2 AS r FROM turns WHERE seq > $1 ORDER BY seq LIMIT $3', [lastSeq, 'calls', BATCH]);
    for (const { seq, r } of rows) { if (ingest(r)) n++; lastSeq = Number(seq); }
    if (rows.length < BATCH) return n;
  }
}

async function refresh() {
  try { status.loaded += await pull(); } catch (e) { fail('postgres', e); }
}

async function insert(r) {
  try {
    await db.query('INSERT INTO turns (id, t, reign, mock, record) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING', [r.id, r.t, r.reign, r.mock, r]);
  } catch (e) { fail('postgres', e); }
}

// ---- local file --------------------------------------------------------------

async function* fileLines() {
  if (!filePath) return;
  let stream;
  try { stream = fs.createReadStream(filePath, 'utf8'); await new Promise((ok, no) => stream.once('open', ok).once('error', no)); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }
  for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) if (line.trim()) yield line;
}

async function openFile() {
  if (!LOG_DIR) return;
  const p = path.resolve(LOG_DIR, 'turns.jsonl');
  try {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    filePath = p;
    for await (const line of fileLines()) { try { if (ingest(JSON.parse(line))) status.loaded++; } catch { /* torn line */ } }
    file = fs.createWriteStream(p, { flags: 'a' });
    file.on('error', (e) => { fail('file', e); file = null; });
    status.store = 'file';
  } catch (e) {
    filePath = null;
    fail('file', e);
    console.error(`Decision log: cannot use ${p}; keeping records in memory only.`);
  }
}

// ---- public API ----------------------------------------------------------------

export function record(r) {
  if (!ingest(r)) return;
  if (db.enabled) insert(r);
  else if (file) file.write(JSON.stringify(r) + '\n');
}

// The full record for one turn: from memory, else Postgres, else the local file. Postgres is asked
// even for an id this instance has not seen yet: another instance may have written it seconds ago.
export async function raw(id) {
  if (rawCache.has(id)) return rawCache.get(id);
  try {
    if (db.enabled) {
      const { rows } = await db.query('SELECT record FROM turns WHERE id = $1', [id]);
      return rows[0]?.record ?? null;
    }
    if (!seen.has(id)) return null;
    const needle = `"id":"${id}"`;
    for await (const line of fileLines()) if (line.includes(needle)) return JSON.parse(line);
  } catch (e) { fail('raw', e); }
  return null;
}

// Every full record in the durable store, oldest first; falls back to what memory has.
export async function* all() {
  if (db.enabled) {
    let after = 0;
    for (;;) {
      let rows;
      try { ({ rows } = await db.query('SELECT seq, record FROM turns WHERE seq > $1 ORDER BY seq LIMIT $2', [after, 500])); }
      catch (e) { fail('postgres', e); return; }
      for (const { seq, record: r } of rows) { after = Number(seq); yield r; }
      if (rows.length < 500) return;
    }
  } else if (filePath) {
    for await (const line of fileLines()) { try { yield JSON.parse(line); } catch { /* torn */ } }
  } else {
    for (const r of records) yield rawCache.get(r.id) || r;
  }
}

export async function start() {
  if (db.enabled) {
    status.store = 'postgres';
    await refresh();
    setInterval(refresh, REFRESH_MS).unref();
  } else {
    await openFile();
  }
  return status;
}
