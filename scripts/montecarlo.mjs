// Monte Carlo the game engine with random answers instead of the model.
// Usage: node scripts/montecarlo.mjs [--n 3000] [--bias 0] [--spread 1] [--seed 1] [--step 9] [--cache data/effects.json] [--player random|cruel] [--cards 15]
//   cache  : use real answers cached by scripts/cache-effects.mjs instead of random ones
//   player : random picks any hand card; cruel picks the hand card with the worst expected outcome for the realm
//   cards  : how many cards to list in the per-card table
//   edges  : cache file made with --states edges; the advisor's answer is taken from the nearest edge state
//   recovery : points every meter regains per turn (overrides RECOVERY)
//   prudence : model (the cached "knows" answer) or derived (computed from the model's own consequence forecasts:
//              the option that leaves the most room before any edge)
//   bias   : shift of the mean consequence score from neutral (2). Negative = outcomes skew bad.
//   spread : std dev of the consequence score around the mean.
//   step   : points per rubric level (overrides EFFECT_STEP).
import fs from 'node:fs';
import * as G from '../game.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] ?? 'true'] : []).filter(Boolean));
const N = Number(args.n ?? 5), BIAS = Number(args.bias ?? 0), SPREAD = Number(args.spread ?? 1), STEP = Number(args.step ?? G.EFFECT_STEP);
const CACHE = args.cache ? JSON.parse(fs.readFileSync(args.cache, 'utf8')).results : null;
const PLAYER = args.player ?? 'random';
const TOP = Number(args.cards ?? 15);
const EDGES = args.edges ? JSON.parse(fs.readFileSync(args.edges, 'utf8')).results : null;
const RECOVERY = Number(args.recovery ?? G.RECOVERY);
const PRUDENCE = args.prudence ?? 'model';
const edgeIndex = {}; // card id -> { 'church/low': know, ... }
if (EDGES) for (const [k, e] of Object.entries(EDGES)) { const [ci, , st] = k.split(':'); (edgeIndex[ci] ||= {})[st] = e.know; }
let seed = Number(args.seed ?? 1) >>> 0 || 1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const DECK = JSON.parse(fs.readFileSync(new URL('../deck.json', import.meta.url), 'utf8'));
DECK.forEach((c, i) => (c.id = i));
const HAND = 5, FLAW_SHARE = 0.45;

function nearestEdge(kingdom) {
  let best = null, dist = 20; // only within 20 points of an edge
  for (const f of G.FACTIONS) {
    if (kingdom[f] < dist) { dist = kingdom[f]; best = `${f}/low`; }
    if (100 - kingdom[f] < dist) { dist = 100 - kingdom[f]; best = `${f}/high`; }
  }
  return best;
}

function cachedAnswers(card, flaw, kingdom) {
  const e = CACHE[`${card.id}:${flaw}`];
  const edge = EDGES && nearestEdge(kingdom);
  let know = (edge && edgeIndex[card.id]?.[edge]) || e.know;
  if (PRUDENCE === 'derived') {
    const margin = (side) => Math.min(...G.FACTIONS.map((f) => { const v = kingdom[f] + delta(e.effects[side][f]) + RECOVERY; return Math.min(v, 100 - v); }));
    const pl = 1 / (1 + Math.exp(-(margin('left') - margin('right')) / 4));
    know = { left: pl, right: 1 - pl };
  }
  const a = {
    decision: { probabilities: e.want, confidence: 0 },
    prudence: { probabilities: know, confidence: 0 },
    trap: { noul: e.trap },
  };
  for (const side of ['left', 'right']) for (const f of G.FACTIONS) a[`${side}_${f}`] = { score: e.effects[side][f] };
  return a;
}

// Expected distance from the nearest edge after this card, given the king's blend. Smaller = closer to a death.
function expectedNet(card, king, kingdom) {
  const e = CACHE[`${card.id}:${flaw(king)}`];
  const pl = (1 - king.wisdom) * e.want.left + king.wisdom * e.know.left;
  const margin = (side) => Math.min(...G.FACTIONS.map((f) => { const v = kingdom[f] + delta(e.effects[side][f]) + RECOVERY; return Math.min(v, 100 - v); }));
  return pl * margin('left') + (1 - pl) * margin('right');
}
const flaw = (king) => king.flaw;

function fakeAnswers() {
  const a = {
    decision: { probabilities: { left: rnd(), right: 0 }, confidence: 0 },
    prudence: { probabilities: { left: rnd(), right: 0 }, confidence: 0 },
    trap: { noul: rnd() },
  };
  a.decision.probabilities.right = 1 - a.decision.probabilities.left;
  a.prudence.probabilities.right = 1 - a.prudence.probabilities.left;
  for (const side of ['left', 'right']) for (const f of G.FACTIONS) {
    const score = Math.max(0, Math.min(4, 2 + BIAS + SPREAD * gauss()));
    a[`${side}_${f}`] = { score };
  }
  return a;
}

// Local copy of resolveTurn's delta rule so --step can vary without editing game.js.
function delta(score) { return Math.max(-2 * STEP, Math.min(2 * STEP, Math.round((score - 2) * STEP))); }

function playReign() {
  const king = G.newKing(rnd);
  let kingdom = G.newKingdom();
  let piles = { flaw: shuffle(DECK.filter((c) => c.tag === king.flaw)), other: shuffle(DECK.filter((c) => c.tag !== king.flaw)) };
  const draw = () => {
    const pf = rnd() < FLAW_SHARE;
    const first = pf ? piles.flaw : piles.other, second = pf ? piles.other : piles.flaw;
    if (first.length) return first.pop();
    if (second.length) return second.pop();
    piles = { flaw: shuffle(DECK.filter((c) => c.tag === king.flaw)), other: shuffle(DECK.filter((c) => c.tag !== king.flaw)) };
    return draw();
  };
  const hand = Array.from({ length: HAND }, draw);
  let year = 1, death = null, flawPlayed = 0;
  while (!death && year < 200) {
    let i = Math.floor(rnd() * HAND);
    if (CACHE && PLAYER === 'cruel') {
      let best = Infinity;
      hand.forEach((c, j) => { const v = expectedNet(c, king, kingdom); if (v < best) { best = v; i = j; } });
    }
    const card = hand[i];
    if (card.tag === king.flaw) flawPlayed++;
    const answers = CACHE ? cachedAnswers(card, king.flaw, kingdom) : fakeAnswers();
    const r = G.resolveTurn({ kingdom, answers, wisdom: king.wisdom, rng: rnd, recovery: RECOVERY });
    // re-apply with the requested step size and recovery
    const next = { ...kingdom };
    for (const f of G.FACTIONS) next[f] = Math.max(0, Math.min(100, next[f] + delta(answers[`${r.chosen}_${f}`].score) + RECOVERY));
    kingdom = next;
    death = G.checkDeath(kingdom);
    const st = (cardStats[card.id] ||= { plays: 0, kills: 0, net: 0, flawSide: 0 });
    st.plays++; st.net += G.FACTIONS.reduce((acc, f) => acc + delta(answers[`${r.chosen}_${f}`].score), 0);
    if (death) st.kills++;
    hand[i] = draw();
    year++;
  }
  return { years: year - 1, death, flaw: king.flaw, wisdom: king.wisdom, flawPlayed };
}

const cardStats = {};
const runs = Array.from({ length: N }, playReign);
const years = runs.map((r) => r.years).sort((a, b) => a - b);
const q = (p) => years[Math.min(years.length - 1, Math.floor(p * years.length))];
const mean = years.reduce((a, b) => a + b, 0) / years.length;
const hist = {};
for (const r of runs) { const k = r.death ? `${r.death.faction}/${r.death.edge}` : 'survived'; hist[k] = (hist[k] || 0) + 1; }
const byFlaw = {};
for (const r of runs) { (byFlaw[r.flaw] ||= []).push(r.years); }
const byWis = { reckless: [], wary: [], shrewd: [] };
for (const r of runs) byWis[G.wisdomLabel(r.wisdom).toLowerCase()].push(r.years);
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);

console.log(CACHE ? `runs=${N} cache=${args.cache} edges=${args.edges ?? 'no'} player=${PLAYER} step=${STEP} recovery=${RECOVERY} prudence=${PRUDENCE}` : `runs=${N} bias=${BIAS} spread=${SPREAD} step=${STEP} recovery=${RECOVERY}`);
console.log(`years: mean ${mean.toFixed(1)}  p10 ${q(0.1)}  p50 ${q(0.5)}  p90 ${q(0.9)}  min ${years[0]}  max ${years.at(-1)}`);
console.log('deaths:', Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / N).toFixed(0)}%`).join('  '));
console.log('by flaw :', Object.entries(byFlaw).map(([k, v]) => `${k} ${avg(v)}`).join('  '));
console.log('by wisdom:', Object.entries(byWis).map(([k, v]) => `${k} ${avg(v)} (n=${v.length})`).join('  '));
console.log(`flaw cards played per reign: ${avg(runs.map((r) => r.flawPlayed))} of ${mean.toFixed(1)} turns`);
if (CACHE) {
  const rows = Object.entries(cardStats).map(([id, st]) => ({ id: Number(id), ...st, avgNet: st.net / st.plays, killRate: st.kills / st.plays }));
  const fmt = (r) => { const c = DECK[r.id]; return `${String(r.avgNet.toFixed(1)).padStart(6)}  ${(100 * r.killRate).toFixed(0).padStart(3)}%  ${String(r.plays).padStart(5)}  ${c.tag.padEnd(8)} ${c.speaker}: ${c.left} / ${c.right}`; };
  console.log(`\nmost harmful ${TOP} cards (avg net meter change of the option the king took, kill rate when played, plays)`);
  rows.sort((a, b) => a.avgNet - b.avgNet).slice(0, TOP).forEach((r) => console.log(fmt(r)));
  console.log(`\nleast harmful ${TOP}`);
  rows.sort((a, b) => b.avgNet - a.avgNet).slice(0, TOP).forEach((r) => console.log(fmt(r)));
  const never = DECK.filter((c) => !cardStats[c.id]);
  if (never.length) console.log(`\nnever played: ${never.length}`);
}
if (N <= 10) for (const r of runs) console.log(' ', r);
