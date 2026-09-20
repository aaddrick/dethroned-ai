// Experiment: does a second call that sees the first call's forecasts give a consistent "prudent" answer?
// Usage: node --env-file=.env scripts/two-call.mjs [--edges data/edges-danger.json] [--mode labels|numbers|both]
import fs from 'node:fs';
import * as G from '../game.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] ?? 'true'] : []).filter(Boolean));
const EDGES = JSON.parse(fs.readFileSync(args.edges ?? 'data/edges-danger.json', 'utf8')).results;
const MODE = args.mode ?? 'both';
const API_KEY = process.env.TYPESAFE_API_KEY;
const DECK = JSON.parse(fs.readFileSync('deck.json', 'utf8'));
const LEVEL = ['collapses', 'falls', 'unchanged', 'rises', 'surges'];

function describe(score) {
  const d = G.scoreToDelta(score);
  const label = LEVEL[Math.max(0, Math.min(4, Math.round(score)))];
  if (MODE === 'labels') return label;
  if (MODE === 'numbers') return d > 0 ? `+${d}` : String(d);
  return `${label} (${d > 0 ? '+' : ''}${d})`;
}

async function ask(state, questions) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: 'jev-latest', state, questions }), signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status !== 529) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  throw new Error('gave up');
}

const jobs = Object.entries(EDGES).map(([k, e]) => ({ k, e }));
let good = 0, cnt = 0, strong = 0, agreeCode = 0, tokens = 0;
const t0 = Date.now();
async function worker() {
  while (jobs.length) {
    const { k, e } = jobs.shift();
    const [ci, flaw, st] = k.split(':');
    const [f, edge] = st.split('/');
    const card = DECK[Number(ci)];
    const kingdom = { ...G.newKingdom(), [f]: edge === 'low' ? 15 : 85 };
    const l = e.effects.left[f], r = e.effects.right[f];
    if (Math.abs(l - r) < 0.3) continue;
    const better = ((l > r) === (edge === 'low')) ? 'left' : 'right';
    const forecast = {};
    for (const side of ['left', 'right']) {
      forecast[card[side]] = Object.fromEntries(G.FACTIONS.map((x) => [x, describe(e.effects[side][x])]));
    }
    const base = G.buildState({ king: { name: 'The Monarch', flaw, wisdom: 0.5 }, kingdom, year: 1, card });
    const state = { ...base, forecast: { note: 'Predicted change to each kingdom value over the next year, by option.', ...forecast } };
    const questions = {
      prudence: {
        type: 'choice',
        instructions:
          'You are the monarch\'s most sober advisor and care only about the realm surviving. ' +
          'The reign ends the moment any kingdom value reaches 0 or 100. Using the forecast and the danger note, ' +
          'which option keeps the endangered value away from its edge? Ignore the monarch\'s temperament.',
        criteria: { left: card.left, right: card.right },
      },
    };
    const reply = await ask(state, questions);
    tokens += reply.usage?.input_tokens ?? 0;
    const p = reply.answers.prudence.probabilities[better];
    cnt++; if (p >= 0.5) good++; if (p >= 0.8) strong++;
    // what code would say from the same forecasts (max-min-margin rule)
    const margin = (side) => Math.min(...G.FACTIONS.map((x) => { const v = kingdom[x] + G.scoreToDelta(e.effects[side][x]); return Math.min(v, 100 - v); }));
    const codeSide = margin('left') >= margin('right') ? 'left' : 'right';
    if (codeSide === better) agreeCode++;
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`mode=${MODE} n=${cnt}  second call protects endangered meter ${(100 * good / cnt).toFixed(0)}%  (>=80% sure ${(100 * strong / cnt).toFixed(0)}%)  code rule from same forecasts ${(100 * agreeCode / cnt).toFixed(0)}%  ${tokens} tokens ${((Date.now() - t0) / 1000).toFixed(0)}s`);
