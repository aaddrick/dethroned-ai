// Ask Jev once per (card, flaw) at a neutral kingdom and cache the raw answers.
// Usage: node --env-file=.env scripts/cache-effects.mjs [--out data/effects.json] [--concurrency 6]
//        [--variant strict|calm] [--states neutral|edges] [--flaws all|<flaw>]
//   states edges: one meter at 15 or 85 (8 kingdoms) so the advisor's edge-awareness can be sampled
import fs from 'node:fs';
import * as G from '../game.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] ?? 'true'] : []).filter(Boolean));
const OUT = args.out ?? 'data/effects.json';
const CONC = Number(args.concurrency ?? 6);
const VARIANT = args.variant ?? G.CONSEQUENCE_VARIANT;
const STATES = args.states ?? 'neutral';
const FLAW_FILTER = args.flaws ?? 'all';
const API_KEY = process.env.TYPESAFE_API_KEY;
if (!API_KEY) { console.error('TYPESAFE_API_KEY missing (run with node --env-file=.env)'); process.exit(1); }

const DECK = JSON.parse(fs.readFileSync(new URL('../deck.json', import.meta.url), 'utf8'));
const FLAWS = FLAW_FILTER === 'all' ? Object.keys(G.FLAWS) : [FLAW_FILTER];
const kingdoms = STATES === 'edges'
  ? G.FACTIONS.flatMap((f) => [['low', 15], ['high', 85]].map(([edge, v]) => ({ name: `${f}/${edge}`, kingdom: { ...G.newKingdom(), [f]: v } })))
  : [{ name: '', kingdom: G.newKingdom() }];
const jobs = [];
DECK.forEach((card, ci) => FLAWS.forEach((flaw) => kingdoms.forEach((k) => jobs.push({ ci, card, flaw, k }))));

async function ask(state, questions) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: 'jev-latest', state, questions }), signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if (res.status !== 429 && res.status !== 529) throw new Error(`${res.status}: ${text.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  throw new Error('gave up after retries');
}

const results = {}; // key `${ci}:${flaw}`
let done = 0, tokens = 0;
const t0 = Date.now();
async function worker() {
  while (jobs.length) {
    const { ci, card, flaw, k } = jobs.shift();
    const turn = { king: { name: 'The Monarch', flaw, wisdom: 0.5 }, kingdom: k.kingdom, year: 1, card };
    const reply = await ask(G.buildState(turn), G.buildQuestions(turn, VARIANT));
    const adv = G.buildAdvisorCall(turn, reply.answers);
    const second = await ask(adv.state, adv.questions);
    const a = { ...reply.answers, ...second.answers };
    const effects = { left: {}, right: {} };
    for (const side of ['left', 'right']) for (const f of G.FACTIONS) effects[side][f] = a[`${side}_${f}`].score;
    results[k.name ? `${ci}:${flaw}:${k.name}` : `${ci}:${flaw}`] = {
      want: a.decision.probabilities, know: a.prudence.probabilities, trap: a.trap.noul, effects, model: reply.model,
    };
    tokens += (reply.usage?.input_tokens ?? 0) + (second.usage?.input_tokens ?? 0);
    if (++done % 96 === 0) console.error(`${done}/${DECK.length * FLAWS.length * kingdoms.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ cachedAt: new Date().toISOString(), variant: VARIANT, states: STATES, deckSize: DECK.length, flaws: FLAWS, results }, null, 1));
console.error(`done: ${done} calls, ${tokens} input tokens, ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${OUT}`);
