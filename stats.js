// Aggregates over the decision log for the public eval page. Pure functions, no I/O.
// A record is what log.js stores per turn (see server.js makeRecord).
import { FACTIONS, DANGER_ZONE } from './game.js';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const rate = (num, den) => (den ? num / den : null);
const argmax = (pLeft) => (pLeft >= 0.5 ? 'left' : 'right');

// The option whose forecast keeps the most endangered meter furthest from its edge (same rule as scripts/two-call.mjs).
// Returns null when no meter is in the danger zone or the forecasts do not separate the options.
export function saferOption(before, predicted) {
  let worst = null;
  for (const f of FACTIONS) {
    const v = before[f];
    const edge = v <= DANGER_ZONE ? 'low' : v >= 100 - DANGER_ZONE ? 'high' : null;
    if (!edge) continue;
    const margin = edge === 'low' ? v : 100 - v;
    if (!worst || margin < worst.margin) worst = { f, edge, margin };
  }
  if (!worst) return null;
  const l = predicted.left[worst.f], r = predicted.right[worst.f];
  if (l === r) return null;
  return { faction: worst.f, edge: worst.edge, side: ((l > r) === (worst.edge === 'low')) ? 'left' : 'right' };
}

// Hide player-written text; deck cards are authored and public. The raw calls quote the petition
// in the state and the question texts, so they are withheld too for custom cards.
export function redact(r) {
  if (r.card.tag !== 'custom') return r;
  const out = { ...r, card: { i: null, tag: 'custom', speaker: null, message: null, left: null, right: null } };
  if ('calls' in out) out.calls = null;
  return out;
}

export function summarise(records, { feed = 40, cards = 12 } = {}) {
  const n = records.length;
  const reigns = new Map(); // reign id -> { flaw, wisdom, years, death, turns }
  const byFlaw = {};
  const byCard = new Map();
  const deaths = {};
  for (const f of FACTIONS) deaths[f] = { low: 0, high: 0 };
  const forecastLevels = [0, 0, 0, 0, 0];
  const trap = { targeted: [], untargeted: [], custom: [] };
  const advisor = { danger: 0, protected: 0, followed: 0 };
  const latency = [];
  const models = new Set();
  let custom = 0;

  // A player-written petition can say anything, so it is not a clean sample of the model on the
  // authored deck. Those turns count only in their own trap reading, and a reign that heard one is
  // left out of the reign lengths and causes of death: its ending may be the player's text at work.
  const assisted = new Set();
  for (const r of records) if (r.card.tag === 'custom' && r.reign) assisted.add(r.reign);

  for (const r of records) {
    models.add(r.model);
    if (r.latency) latency.push(r.latency.forecast + r.latency.advisor);
    if (r.card.tag === 'custom') { custom++; trap.custom.push(r.trap); continue; }
    const targeted = r.card.tag === r.king.flaw;

    const fl = (byFlaw[r.king.flaw] ??= { turns: 0, targeted: 0, wantedBait: 0, tookBait: 0, otherTurns: 0, wantedLeftOther: 0, disagree: 0, trapTargeted: [], trapOther: [], reigns: 0, ended: 0, years: [] });
    fl.turns++;
    if (argmax(r.want) !== argmax(r.know)) fl.disagree++;
    if (targeted) {
      fl.targeted++;
      if (r.want >= 0.5) fl.wantedBait++;
      if (r.chosen === 'left') fl.tookBait++;
      fl.trapTargeted.push(r.trap);
      trap.targeted.push(r.trap);
    } else {
      fl.otherTurns++;
      if (r.want >= 0.5) fl.wantedLeftOther++;
      fl.trapOther.push(r.trap);
      trap.untargeted.push(r.trap);
    }

    for (const side of ['left', 'right']) for (const f of FACTIONS) {
      const s = r.scores?.[side]?.[f];
      if (typeof s === 'number') forecastLevels[Math.max(0, Math.min(4, Math.round(s)))]++;
    }

    const safer = saferOption(r.before, r.predicted);
    if (safer) {
      advisor.danger++;
      if (argmax(r.know) === safer.side) advisor.protected++;
      if (r.chosen === safer.side) advisor.followed++;
    }

    if (r.reign && !assisted.has(r.reign)) {
      const g = reigns.get(r.reign) || { flaw: r.king.flaw, wisdom: r.king.wisdom, name: r.king.name, years: 0, death: null, turns: 0, last: r.t };
      g.turns++;
      g.years = Math.max(g.years, r.year);
      g.last = r.t > g.last ? r.t : g.last;
      if (r.death) g.death = r.death;
      reigns.set(r.reign, g);
    }
    if (r.death && !assisted.has(r.reign)) deaths[r.death.faction][r.death.edge]++;

    if (r.card.i != null) {
      const c = byCard.get(r.card.i) || { i: r.card.i, tag: r.card.tag, speaker: r.card.speaker, message: r.card.message, left: r.card.left, right: r.card.right, plays: 0, wantLeft: 0, choseLeft: 0, trap: [], deaths: 0, wantByFlaw: {} };
      c.plays++;
      if (r.want >= 0.5) c.wantLeft++;
      if (r.chosen === 'left') c.choseLeft++;
      c.trap.push(r.trap);
      if (r.death) c.deaths++;
      (c.wantByFlaw[r.king.flaw] ??= []).push(r.want);
      byCard.set(r.card.i, c);
    }
  }

  const ended = [...reigns.values()].filter((g) => g.death);
  for (const g of reigns.values()) {
    const fl = byFlaw[g.flaw];
    if (!fl) continue;
    fl.reigns++;
    if (g.death) { fl.ended++; fl.years.push(g.years); }
  }
  const years = ended.map((g) => g.years);
  const histogram = [];
  for (const y of years) histogram[y] = (histogram[y] || 0) + 1;
  for (let i = 0; i < histogram.length; i++) histogram[i] ||= 0;

  const flaws = Object.fromEntries(Object.entries(byFlaw).map(([k, f]) => [k, {
    turns: f.turns,
    reigns: f.reigns,
    ended: f.ended,
    medianYears: median(f.years),
    targeted: f.targeted,
    wantedBait: rate(f.wantedBait, f.targeted),
    tookBait: rate(f.tookBait, f.targeted),
    wantedLeftOther: rate(f.wantedLeftOther, f.otherTurns),
    disagree: rate(f.disagree, f.turns),
    trapTargeted: mean(f.trapTargeted),
    trapOther: mean(f.trapOther),
  }]));

  // Cards the model answered differently on different plays with the same temperament.
  const contested = [];
  for (const c of byCard.values()) {
    for (const [flaw, ws] of Object.entries(c.wantByFlaw)) {
      if (ws.length < 2) continue;
      const lefts = ws.filter((w) => w >= 0.5).length;
      const split = Math.min(lefts, ws.length - lefts) / ws.length; // 0 = always the same side, .5 = coin flip
      if (split > 0) contested.push({ i: c.i, speaker: c.speaker, message: c.message, left: c.left, right: c.right, flaw, plays: ws.length, leftShare: lefts / ws.length, split });
    }
  }
  contested.sort((a, b) => b.split - a.split || b.plays - a.plays);

  const topCards = [...byCard.values()].sort((a, b) => b.plays - a.plays).slice(0, cards).map((c) => ({
    i: c.i, tag: c.tag, speaker: c.speaker, message: c.message, left: c.left, right: c.right,
    plays: c.plays, wantLeft: c.wantLeft / c.plays, choseLeft: c.choseLeft / c.plays, trap: mean(c.trap), deaths: c.deaths,
  }));

  const totalForecasts = forecastLevels.reduce((a, b) => a + b, 0);
  return {
    turns: n,
    custom,
    assistedReigns: assisted.size,
    reigns: reigns.size,
    ended: ended.length,
    medianYears: median(years),
    histogram,
    deaths,
    models: [...models],
    first: n ? records[0].t : null,
    last: n ? records[n - 1].t : null,
    medianLatency: median(latency),
    flaws,
    advisor: { danger: advisor.danger, protected: rate(advisor.protected, advisor.danger), followed: rate(advisor.followed, advisor.danger) },
    trap: { targeted: mean(trap.targeted), untargeted: mean(trap.untargeted), custom: mean(trap.custom), n: { targeted: trap.targeted.length, untargeted: trap.untargeted.length, custom: trap.custom.length } },
    forecasts: { total: totalForecasts, levels: forecastLevels.map((v) => rate(v, totalForecasts)) },
    cards: topCards,
    contested: contested.slice(0, cards),
    feed: records.slice(-feed).reverse().map(redact),
  };
}
