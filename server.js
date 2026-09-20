// Dethrone: zero-dependency Node server. Serves the UI, proxies two Jev calls per turn, and logs every decision.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  FACTIONS, FLAWS, EFFECT_STEP, CONSEQUENCE_VARIANT, newKing, newKingdom, wisdomLabel, buildState, buildQuestions, buildAdvisorCall, resolveTurn,
} from './game.js';
import * as db from './db.js';
import * as log from './log.js';
import { summarise, redact } from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.TYPESAFE_API_KEY || '';
const MODEL = process.env.JEV_MODEL || 'jev-latest';
const MOCK = process.env.JEV_MOCK === '1' || !API_KEY;
const API_URL = 'https://api.typesafe.ai/v1/systemone';
const DECK = JSON.parse(await fs.readFile(path.join(__dirname, 'deck.json'), 'utf8'));
const DECK_INDEX = new Map(DECK.map((c, i) => [c.message, i]));

// Abuse limits for a public deployment: a per-IP window and an in-flight cap. The window is counted
// in Postgres when there is one, so it holds across Cloud Run instances; the in-flight cap is per
// instance on purpose, it protects this process and the model from a burst.
const PER_IP_PER_MIN = Number(process.env.PER_IP_PER_MIN || 30);
const MAX_IN_FLIGHT = Number(process.env.MAX_IN_FLIGHT || 8);
const ipHits = new Map();
let inFlight = 0;

async function rateLimited(ip) {
  if (db.enabled) {
    try { return await db.rateLimited(ip, PER_IP_PER_MIN); }
    catch (e) { console.error('Rate limit (postgres):', e.message); /* fall through to the local window */ }
  }
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (hits.length >= PER_IP_PER_MIN) { ipHits.set(ip, hits); return true; }
  hits.push(now);
  ipHits.set(ip, hits);
  return false;
}
setInterval(() => { for (const [ip, hits] of ipHits) if (!hits.length || Date.now() - hits.at(-1) > 60_000) ipHits.delete(ip); }, 60_000).unref();

// ---- Jev call -------------------------------------------------------------

async function callJev(state, questions) {
  if (MOCK) return mockJev(state, questions);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: MODEL, state, questions }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    lastErr = new Error(`Jev ${res.status}: ${text.slice(0, 300)}`);
    lastErr.status = res.status;
    if (res.status !== 429 && res.status !== 529) throw lastErr;
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
  }
  throw lastErr;
}

// Deterministic fake answers so the UI can be developed without a key.
function mockJev(state, questions) {
  let h = 2166136261;
  for (const ch of JSON.stringify(state)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rng = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  const answers = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === 'noul') answers[name] = { type: 'noul', noul: +rng().toFixed(3) };
    else if (q.type === 'choice') {
      const keys = Object.keys(q.criteria);
      const raw = keys.map(() => rng() + 0.05);
      const sum = raw.reduce((a, b) => a + b, 0);
      const probabilities = Object.fromEntries(keys.map((k, i) => [k, +(raw[i] / sum).toFixed(3)]));
      const choice = keys.reduce((a, b) => (probabilities[a] >= probabilities[b] ? a : b));
      const sorted = Object.values(probabilities).sort((a, b) => b - a);
      answers[name] = { type: 'choice', choice, probabilities, confidence: +(sorted[0] - (sorted[1] || 0)).toFixed(3) };
    } else {
      const n = q.criteria.length;
      const center = rng() * (n - 1);
      const raw = q.criteria.map((_, i) => Math.exp(-((i - center) ** 2) / 0.8));
      const sum = raw.reduce((a, b) => a + b, 0);
      const probabilities = Object.fromEntries(raw.map((v, i) => [String(i), +(v / sum).toFixed(3)]));
      const score = raw.reduce((acc, v, i) => acc + (i * v) / sum, 0);
      answers[name] = { type: 'score', score: +score.toFixed(3), legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])), probabilities, confidence: +Math.max(...Object.values(probabilities)).toFixed(3) };
    }
  }
  return new Promise((r) => setTimeout(() => r({ model: 'jev-mock', answers, usage: { input_tokens: 0, output_tokens: 0 } }), 120 + rng() * 200));
}

// ---- validation -----------------------------------------------------------

const MAX_TEXT = 600;
function cleanText(v, max = MAX_TEXT) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseTurn(body) {
  const king = body?.king || {};
  if (!FLAWS[king.flaw]) throw new Error('Unknown king temperament.');
  const kingdom = {};
  for (const f of FACTIONS) {
    const v = Number(body?.kingdom?.[f]);
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error(`Bad kingdom value for ${f}.`);
    kingdom[f] = Math.round(v);
  }
  const year = Math.max(1, Math.min(999, Math.round(Number(body?.year) || 1)));
  const card = {
    speaker: cleanText(body?.card?.speaker, 60) || 'A Petitioner',
    message: cleanText(body?.card?.message),
    left: cleanText(body?.card?.left, 40),
    right: cleanText(body?.card?.right, 40),
  };
  if (card.message.length < 3) throw new Error('Write the petition first.');
  if (!card.left || !card.right) throw new Error('Both options need a label.');
  if (card.left.toLowerCase() === card.right.toLowerCase()) throw new Error('The two options must differ.');
  const wisdom = Number(king.wisdom);
  if (!Number.isFinite(wisdom) || wisdom < 0 || wisdom > 1) throw new Error('Bad wisdom value.');
  const reign = /^[0-9a-f-]{36}$/.test(String(body?.reign || '')) ? body.reign : null;
  return { king: { name: cleanText(king.name, 40) || 'The Monarch', flaw: king.flaw, wisdom }, kingdom, year, card, reign };
}

// ---- decision log ---------------------------------------------------------
// One record per turn: the state the model saw, what it answered, and what the game did with it.

// One timed call to the model, kept with the exact request body and the exact response body.
async function jevCall(name, state, questions) {
  const at = new Date().toISOString();
  const t0 = performance.now();
  const response = await callJev(state, questions);
  return { name, at, latencyMs: Math.round(performance.now() - t0), request: { model: MODEL, state, questions }, response };
}

// The summary fields up top are what the stats and the feed use; `calls` is the raw material for any
// other analysis: both requests as sent and both responses as returned, untouched.
function makeRecord(turn, calls, answers, result) {
  const i = DECK_INDEX.get(turn.card.message);
  const deckCard = i != null ? DECK[i] : null;
  const isDeck = deckCard && deckCard.left === turn.card.left && deckCard.right === turn.card.right;
  const scores = { left: {}, right: {} };
  for (const side of ['left', 'right']) for (const f of FACTIONS) scores[side][f] = Number(answers[`${side}_${f}`].score);
  return {
    v: 2,
    id: crypto.randomUUID(),
    t: calls[0].at,
    reign: turn.reign,
    mock: MOCK,
    model: calls[0].response.model,
    prompt: CONSEQUENCE_VARIANT,
    step: EFFECT_STEP,
    recovery: result.recovery,
    year: turn.year,
    king: turn.king,
    before: turn.kingdom,
    card: { i: isDeck ? i : null, tag: isDeck ? deckCard.tag : 'custom', ...turn.card },
    want: result.want.left,
    know: result.know.left,
    blend: result.blend.left,
    roll: result.roll,
    confidence: result.confidence,
    prudenceConfidence: result.prudenceConfidence,
    trap: result.trap,
    scores,
    predicted: result.predicted,
    chosen: result.chosen,
    applied: result.applied,
    after: result.kingdom,
    death: result.death ? { faction: result.death.faction, edge: result.death.edge } : null,
    latency: { forecast: calls[0].latencyMs, advisor: calls[1].latencyMs },
    tokens: calls.reduce((n, c) => n + (c.response.usage?.input_tokens ?? 0), 0),
    calls,
  };
}

// Public stats are over real answers only, unless this whole server runs on mock answers.
const evalRecords = () => log.records.filter((r) => r.mock === MOCK);
let evalCache = { at: 0, n: -1, body: '' };
function evalJson() {
  const rs = evalRecords();
  if (Date.now() - evalCache.at > 10_000 || evalCache.n !== rs.length) {
    evalCache = { at: Date.now(), n: rs.length, body: JSON.stringify({ ...summarise(rs), mock: MOCK, log: log.status }) };
  }
  return evalCache.body;
}

// ---- HTTP -----------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Error('Body too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '?';
  try {
    if (url.pathname === '/api/reign' && req.method === 'GET') {
      const king = newKing();
      return json(res, 200, { reign: crypto.randomUUID(), king, flaw: FLAWS[king.flaw], wisdomLabel: wisdomLabel(king.wisdom), kingdom: newKingdom(), year: 1, mock: MOCK, model: MODEL, deck: DECK });
    }
    if (url.pathname === '/api/eval' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=10' });
      return res.end(evalJson());
    }
    if (url.pathname === '/api/eval/export' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'attachment; filename="dethrone-decisions.jsonl"', 'Cache-Control': 'public, max-age=60' });
      for await (const r of log.all()) {
        if (r.mock !== MOCK) continue;
        if (!res.write(JSON.stringify(redact(r)) + '\n')) await new Promise((ok) => res.once('drain', ok));
      }
      return res.end();
    }
    const turnMatch = req.method === 'GET' && url.pathname.match(/^\/api\/eval\/turn\/([0-9a-f-]{36})$/);
    if (turnMatch) {
      const r = await log.raw(turnMatch[1]);
      if (!r || r.mock !== MOCK) return json(res, 404, { error: 'No such turn in the chronicle.' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
      return res.end(JSON.stringify(redact(r)));
    }
    if (url.pathname === '/api/turn' && req.method === 'POST') {
      if (await rateLimited(ip)) return json(res, 429, { error: 'Slow down. The court hears at most 30 petitions a minute from one voice.' });
      if (inFlight >= MAX_IN_FLIGHT) return json(res, 503, { error: 'The court is crowded. Try again in a moment.' });
      inFlight++;
      try {
        const turn = parseTurn(await readBody(req));
        const first = await jevCall('forecast', buildState(turn), buildQuestions(turn));
        const advisor = buildAdvisorCall(turn, first.response.answers);
        const second = await jevCall('advisor', advisor.state, advisor.questions);
        const answers = { ...first.response.answers, ...second.response.answers };
        const result = resolveTurn({ kingdom: turn.kingdom, answers, wisdom: turn.king.wisdom });
        const rec = makeRecord(turn, [first, second], answers, result);
        log.record(rec);
        const usage = { input_tokens: rec.tokens, output_tokens: (first.response.usage?.output_tokens ?? 0) + (second.response.usage?.output_tokens ?? 0) };
        return json(res, 200, { ...result, id: rec.id, year: turn.year + 1, latencyMs: rec.latency.forecast + rec.latency.advisor, latency: rec.latency, model: rec.model, usage, mock: MOCK, raw: { forecast: first.response.answers, advisor: second.response.answers, advisorSaw: advisor.state.forecast } });
      } finally { inFlight--; }
    }
    // static
    let file = url.pathname === '/' ? '/index.html' : url.pathname === '/eval' ? '/eval.html' : url.pathname;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(__dirname, 'public', file);
    if (!full.startsWith(path.join(__dirname, 'public'))) return json(res, 404, { error: 'Not found' });
    try {
      const data = await fs.readFile(full);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      return res.end(data);
    } catch { return json(res, 404, { error: 'Not found' }); }
  } catch (err) {
    const status = err.status === 429 ? 429 : err.status === 529 ? 503 : 400;
    return json(res, status, { error: err.message || 'Something went wrong.' });
  }
});

await db.start();
const logStatus = await log.start();
server.listen(PORT, () => {
  console.log(`Dethrone listening on http://localhost:${PORT}  (${MOCK ? 'MOCK answers: set TYPESAFE_API_KEY for the real model' : `model ${MODEL}`})`);
  console.log(`Decision log: ${log.records.length} records loaded, store ${logStatus.store}`);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => server.close(async () => { await db.stop(); process.exit(0); }));
