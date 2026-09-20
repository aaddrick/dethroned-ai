// Dethrone: zero-dependency Node server. Serves the UI, proxies two Jev calls per turn, and logs every decision.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  FACTIONS, FLAWS, DEATHS, EFFECT_STEP, CONSEQUENCE_VARIANT, newKing, newKingdom, wisdomLabel, buildState, buildQuestions, buildAdvisorCall, resolveTurn,
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

// Abuse limits for a public deployment: a per-IP window and an in-flight cap. The window is counted
// in Postgres when there is one, so it holds across Cloud Run instances; the in-flight cap is per
// instance on purpose, it protects this process and the model from a burst.
// DAILY_TURN_CAP is a ceiling on turns from everyone in one UTC day. The model costs next to nothing;
// the cap is there so a flood cannot bury the chronicle.
const PER_IP_PER_MIN = Number(process.env.PER_IP_PER_MIN || 30);
const MAX_IN_FLIGHT = Number(process.env.MAX_IN_FLIGHT || 8);
const DAILY_TURN_CAP = Number(process.env.DAILY_TURN_CAP || 20_000);
// Which X-Forwarded-For entry is the client, counted from the right. The left of the header is
// whatever the client sent, so only the entries appended by Google's proxies can be trusted:
// 1 on the *.run.app URL (client), 2 behind the load balancer (client, balancer). 0 ignores the
// header and uses the socket address, which is right on a laptop.
const XFF_FROM_RIGHT = Number(process.env.XFF_FROM_RIGHT || 0);
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

const day = () => new Date().toISOString().slice(0, 10);
let dayHits = { day: day(), hits: 0 };
async function dayCapped() {
  if (db.enabled) {
    try { return await db.dayLimited(DAILY_TURN_CAP); }
    catch (e) { console.error('Daily cap (postgres):', e.message); }
  }
  if (dayHits.day !== day()) dayHits = { day: day(), hits: 0 };
  return ++dayHits.hits > DAILY_TURN_CAP;
}

function clientIp(req) {
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((h) => h.trim()).filter(Boolean);
  return (XFF_FROM_RIGHT > 0 && hops.at(-XFF_FROM_RIGHT)) || req.socket.remoteAddress || '?';
}

// A turn is only ever posted by our own page. Anything a browser marks as coming from another site
// is refused, and so is a body that is not declared as JSON: a cross-site form or a no-cors fetch
// cannot set that content type, so another page cannot spend its visitors' allowance here.
function refuseForeign(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return 'Send the turn as application/json.';
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return 'Petitions are heard in the throne room only.';
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return 'Petitions are heard in the throne room only.'; } catch { return 'Bad origin.'; } }
  return null;
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
// Player-written text: compatibility forms folded (NFKC), invisible and bidi-override characters
// dropped, whitespace and control characters collapsed, then cut by code point so a surrogate pair
// is never split (Postgres refuses a lone surrogate in jsonb).
function cleanText(v, max = MAX_TEXT) {
  const s = String(v ?? '').normalize('NFKC').replace(/[\p{Cf}\p{Co}\p{Cn}\p{Cs}]/gu, '').replace(/[\s\p{Cc}]+/gu, ' ').trim();
  return Array.from(s).slice(0, max).join('').trim();
}

// ---- signed reign state ---------------------------------------------------
// The server keeps no session. Instead the king, the meters and the year travel with the client as
// a token signed here, and a turn is only played against a token this server issued. The client can
// read the state but cannot write it: a forged king, a meter set to 1 or a made-up year does not
// verify. Each turn's response carries the token for the next year; a dead reign gets none.

const STATE_SECRET = process.env.STATE_SECRET || '';
if (!STATE_SECRET && process.env.K_SERVICE) {
  // Instances must agree on the key, and a restart must not strand every reign in progress.
  console.error('STATE_SECRET is not set. It is required on Cloud Run.');
  process.exit(1);
}
// Without one (a laptop), a key made up at start: reigns in progress end when the server restarts.
const stateKey = STATE_SECRET ? Buffer.from(STATE_SECRET) : crypto.randomBytes(32);
const TOKEN_MAX_AGE_MS = 24 * 3600_000;

const mac = (payload) => crypto.createHmac('sha256', stateKey).update(payload).digest('base64url');

function signState({ reign, king, kingdom, year }) {
  const payload = Buffer.from(JSON.stringify({ reign, king, kingdom, year, iat: Date.now() })).toString('base64url');
  return `${payload}.${mac(payload)}`;
}

function readState(token) {
  const [payload, sig] = String(token || '').split('.');
  const good = payload && sig && Buffer.from(mac(payload));
  if (!good || good.length !== Buffer.byteLength(sig) || !crypto.timingSafeEqual(good, Buffer.from(sig))) throw new Error('This reign is not one the court remembers. Crown a new one.');
  const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (Date.now() - state.iat > TOKEN_MAX_AGE_MS) throw new Error('This reign has gone stale. Crown a new one.');
  return state;
}

// A turn is a token plus a card. Deck cards are named by index and their text comes from deck.json,
// so nothing a player typed can ride in on an authored card. Free text only arrives as `custom`.
function parseTurn(body) {
  const { reign, king, kingdom, year } = readState(body?.token);
  let card, i = null;
  if (body?.custom) {
    card = {
      speaker: cleanText(body.custom.speaker, 60) || 'A Petitioner',
      message: cleanText(body.custom.message),
      left: cleanText(body.custom.left, 40),
      right: cleanText(body.custom.right, 40),
    };
    if (card.message.length < 3) throw new Error('Write the petition first.');
    if (!card.left || !card.right) throw new Error('Both options need a label.');
    if (card.left.toLowerCase() === card.right.toLowerCase()) throw new Error('The two options must differ.');
  } else {
    i = Number(body?.i);
    if (!Number.isInteger(i) || !DECK[i]) throw new Error('No such petition in the deck.');
    card = { speaker: DECK[i].speaker, message: DECK[i].message, left: DECK[i].left, right: DECK[i].right };
  }
  return { king, kingdom, year, card, reign, i };
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
  const scores = { left: {}, right: {} };
  for (const side of ['left', 'right']) for (const f of FACTIONS) scores[side][f] = Number(answers[`${side}_${f}`].score);
  return {
    v: 3,
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
    card: { i: turn.i, tag: turn.i == null ? 'custom' : DECK[turn.i].tag, ...turn.card },
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

// What the client gets back for a turn, built from the record alone so that a turn answered fresh and
// the same turn asked for again are the same answer.
function turnResponse(rec) {
  const [first, second] = rec.calls;
  const pair = (left) => ({ left, right: 1 - left });
  const death = rec.death ? { ...rec.death, text: DEATHS[rec.death.faction][rec.death.edge] } : null;
  const year = rec.year + 1;
  return {
    id: rec.id, chosen: rec.chosen, roll: rec.roll, want: pair(rec.want), know: pair(rec.know), blend: pair(rec.blend),
    confidence: rec.confidence, prudenceConfidence: rec.prudenceConfidence, trap: rec.trap,
    predicted: rec.predicted, recovery: rec.recovery, applied: rec.applied, kingdom: rec.after, death, year,
    token: death ? null : signState({ reign: rec.reign, king: rec.king, kingdom: rec.after, year }),
    latencyMs: rec.latency.forecast + rec.latency.advisor, latency: rec.latency, model: rec.model, mock: rec.mock,
    usage: { input_tokens: rec.tokens, output_tokens: (first.response.usage?.output_tokens ?? 0) + (second.response.usage?.output_tokens ?? 0) },
    raw: { forecast: first.response.answers, advisor: second.response.answers, advisorSaw: second.request.state.forecast },
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

// Scripts from this origin only. Styles allow inline because the meters and bars set their widths
// in style attributes; fonts come from Google.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = clientIp(req);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    if (url.pathname === '/api/reign' && req.method === 'GET') {
      const king = newKing();
      const reign = crypto.randomUUID();
      const kingdom = newKingdom();
      return json(res, 200, { reign, token: signState({ reign, king, kingdom, year: 1 }), king, flaw: FLAWS[king.flaw], wisdomLabel: wisdomLabel(king.wisdom), kingdom, year: 1, mock: MOCK, model: MODEL, deck: DECK });
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
      const foreign = refuseForeign(req);
      if (foreign) return json(res, foreign.startsWith('Send') ? 415 : 403, { error: foreign });
      if (await rateLimited(ip)) return json(res, 429, { error: `Slow down. The court hears at most ${PER_IP_PER_MIN} petitions a minute from one voice.` });
      if (await dayCapped()) return json(res, 429, { error: 'The court has heard enough for one day. Come back tomorrow.' });
      if (inFlight >= MAX_IN_FLIGHT) return json(res, 503, { error: 'The court is crowded. Try again in a moment.' });
      inFlight++;
      try {
        const turn = parseTurn(await readBody(req));
        // One decision per reign and year. A token played twice gets the first answer back, so a
        // lost response can be retried and a bad roll cannot be re-rolled.
        const played = await log.played(turn.reign, turn.year);
        if (played) return played.calls ? json(res, 200, { ...turnResponse(played), replayed: true }) : json(res, 409, { error: 'That year has already been decided.' });
        const first = await jevCall('forecast', buildState(turn), buildQuestions(turn));
        const advisor = buildAdvisorCall(turn, first.response.answers);
        const second = await jevCall('advisor', advisor.state, advisor.questions);
        const answers = { ...first.response.answers, ...second.response.answers };
        const result = resolveTurn({ kingdom: turn.kingdom, answers, wisdom: turn.king.wisdom });
        const rec = makeRecord(turn, [first, second], answers, result);
        if (!(await log.record(rec))) {
          // Two requests raced on the same year and the other one was written first.
          const winner = await log.played(turn.reign, turn.year);
          if (winner?.calls) return json(res, 200, { ...turnResponse(winner), replayed: true });
          return json(res, 409, { error: 'That year has already been decided.' });
        }
        return json(res, 200, turnResponse(rec));
      } finally { inFlight--; }
    }
    // static
    let file = url.pathname === '/' ? '/index.html' : url.pathname === '/eval' ? '/eval.html' : url.pathname;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(__dirname, 'public', file);
    if (!full.startsWith(path.join(__dirname, 'public'))) return json(res, 404, { error: 'Not found' });
    try {
      const data = await fs.readFile(full);
      const type = MIME[path.extname(full)] || 'application/octet-stream';
      res.writeHead(200, type.startsWith('text/html') ? { 'Content-Type': type, 'Content-Security-Policy': CSP } : { 'Content-Type': type });
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
