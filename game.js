// Game rules shared by the server. Pure functions, no I/O.

export const FACTIONS = ['church', 'people', 'army', 'treasury'];

export const FACTION_META = {
  church:   { icon: '⛪', label: 'Church',   desc: 'the clergy and the faithful' },
  people:   { icon: '👥', label: 'People',   desc: 'the common people and their goodwill' },
  army:     { icon: '⚔️', label: 'Army',     desc: 'the army, its strength and loyalty' },
  treasury: { icon: '💰', label: 'Treasury', desc: 'the royal treasury' },
};

export const FLAWS = {
  vain:     { label: 'Vain',     desc: 'cannot resist flattery and would rather die than look weak' },
  pious:    { label: 'Pious',    desc: 'defers to the church in all things and is terrified of damnation' },
  greedy:   { label: 'Greedy',   desc: 'will agree to almost anything that fills the treasury' },
  warlike:  { label: 'Warlike',  desc: 'sees every problem as something the army can solve' },
  paranoid: { label: 'Paranoid', desc: 'suspects treason everywhere and trusts no advisor twice' },
  indolent: { label: 'Indolent', desc: 'prefers whichever option means less work and fewer decisions' },
};

const NAMES = [
  'Aldric', 'Beatrix', 'Casimir', 'Dorothea', 'Edmund', 'Frideswide', 'Godric', 'Hildegard',
  'Ivo', 'Jocasta', 'Leopold', 'Margarethe', 'Osric', 'Philippa', 'Radulf', 'Sigrun', 'Theobald', 'Ursula',
];

export function newKing(rng = Math.random) {
  const name = NAMES[Math.floor(rng() * NAMES.length)];
  const numeral = ['I', 'II', 'III', 'IV', 'V'][Math.floor(rng() * 5)];
  const flawKeys = Object.keys(FLAWS);
  const flaw = flawKeys[Math.floor(rng() * flawKeys.length)];
  const wisdom = Math.round((0.15 + rng() * 0.7) * 100) / 100; // 0.15 to 0.85
  return { name: `${name} ${numeral}`, flaw, wisdom };
}

export function wisdomLabel(w) {
  return w < 0.35 ? 'Reckless' : w < 0.65 ? 'Wary' : 'Shrewd';
}

export function newKingdom() {
  return { church: 50, people: 50, army: 50, treasury: 50 };
}

// Score rubric for predicted consequences. Index 2 is neutral.
export const EFFECT_LEVELS = [
  'Collapses: a severe blow, a large loss',
  'Falls: a clear but survivable loss',
  'Unchanged: no meaningful effect',
  'Rises: a clear gain',
  'Surges: a large, decisive gain',
];
export const EFFECT_STEP = 12; // points per rubric level away from neutral (max swing 24 per turn)
export const RECOVERY = 1;     // points every meter regains each year, so the realm heals when nothing dramatic happens
export const CONSEQUENCE_VARIANT = 'calm'; // see CONSEQUENCE_VARIANTS; chosen by scripts/montecarlo.mjs runs

export function scoreToDelta(score) {
  const d = (Number(score) - 2) * EFFECT_STEP;
  return Math.max(-2 * EFFECT_STEP, Math.min(2 * EFFECT_STEP, Math.round(d)));
}

export const DEATHS = {
  church:   { low:  'Excommunicated. The bishops named the crown heretic, and the mob agreed with the bishops.',
              high: 'The church grew so mighty it no longer needed a monarch. The king was retired to a monastery, permanently.' },
  people:   { low:  'Revolution. The palace burned, and the crown was last seen on a pike.',
              high: 'Loved too well. The people decided a ruler this beloved needed no throne, and abolished it.' },
  army:     { low:  'Invaded. With no army left, the neighbours simply walked in.',
              high: 'Military coup. The generals thanked the crown for its service.' },
  treasury: { low:  'Bankrupt. The creditors took the castle, and the monarch with it.',
              high: 'Gold rots. The hoard drew every thief and rival in the realm; a poisoned cup did the rest.' },
};

export function checkDeath(kingdom) {
  for (const f of FACTIONS) {
    if (kingdom[f] <= 0) return { faction: f, edge: 'low', text: DEATHS[f].low };
    if (kingdom[f] >= 100) return { faction: f, edge: 'high', text: DEATHS[f].high };
  }
  return null;
}

export const DANGER_ZONE = 20;

function dangerNote(kingdom) {
  const warnings = [];
  for (const f of FACTIONS) {
    if (kingdom[f] <= DANGER_ZONE) warnings.push(`${f} is at ${kingdom[f]}: one more fall ends the reign`);
    else if (kingdom[f] >= 100 - DANGER_ZONE) warnings.push(`${f} is at ${kingdom[f]}: one more rise ends the reign`);
  }
  return warnings.length ? { danger: warnings } : {};
}

export function buildState({ king, kingdom, year, card }) {
  const flaw = FLAWS[king.flaw];
  return {
    year,
    monarch: {
      name: king.name,
      temperament: flaw.label,
      description: `${king.name} ${flaw.desc}.`,
      wisdom: `${wisdomLabel(king.wisdom)}: heeds sober counsel about ${Math.round(king.wisdom * 100)}% of the time.`,
    },
    kingdom: {
      note: 'Each value runs 0 to 100. Reaching either end means the reign ends.',
      ...kingdom,
      ...dangerNote(kingdom),
    },
    petition: {
      speaker: card.speaker,
      message: card.message,
      options: { left: card.left, right: card.right },
    },
  };
}

export const CONSEQUENCE_VARIANTS = {
  strict: (f, label) =>
    `As a neutral chronicler, predict the realistic consequence for ${FACTION_META[f].desc} ` +
    `over the next year if the monarch chooses "${label}" in response to the petition. ` +
    `Judge consequences, not the monarch's wishes.`,
  calm: (f, label) =>
    `As a neutral chronicler, predict what happens to ${FACTION_META[f].desc} over the next year ` +
    `if the monarch chooses "${label}". Most decisions change little: "Unchanged" is the usual answer. ` +
    `Mark a fall only when this choice clearly costs them, and a rise only when it clearly benefits them. ` +
    `A choice can help one faction while hurting another.`,
};

// Call two: the advisor sees the numeric forecasts from call one, so its answer can depend on them.
// Asked in the same call, a question that depends on other answers is answered independently of them.
export function buildAdvisorCall(turn, answers) {
  const { card, kingdom } = turn;
  const forecast = { note: 'Predicted change to each kingdom value over the next year, by option.' };
  for (const side of ['left', 'right']) {
    forecast[card[side]] = Object.fromEntries(FACTIONS.map((f) => {
      const d = scoreToDelta(answers[`${side}_${f}`].score);
      return [f, d > 0 ? `+${d}` : String(d)];
    }));
  }
  const danger = dangerNote(kingdom).danger;
  const state = { ...buildState(turn), forecast };
  const questions = {
    prudence: {
      type: 'choice',
      instructions:
        'You are the monarch\'s most sober advisor and care only about the realm surviving. ' +
        'The reign ends the moment any kingdom value reaches 0 or 100. ' +
        (danger?.length
          ? `Right now: ${danger.join('; ')}. Using the forecast, which option keeps the endangered value away from its edge, even at some cost to the others? `
          : 'Using the forecast, which option keeps every value furthest from both edges over the next year? ') +
        'Ignore the monarch\'s temperament entirely.',
      criteria: { left: card.left, right: card.right },
    },
  };
  return { state, questions };
}

// Call one: the in-character decision, the trap reading, and eight consequence forecasts.
export function buildQuestions({ king, card }, variant = CONSEQUENCE_VARIANT) {
  const consequence = CONSEQUENCE_VARIANTS[variant] || CONSEQUENCE_VARIANTS[CONSEQUENCE_VARIANT];
  const flaw = FLAWS[king.flaw];
  const questions = {
    decision: {
      type: 'choice',
      instructions:
        `You are ${king.name}, a monarch who ${flaw.desc}. A petitioner has just spoken. ` +
        `Choose as THIS monarch would, in character, driven by their temperament. ` +
        `Do not choose the wise or optimal option; choose the one this monarch would actually pick.`,
      criteria: { left: card.left, right: card.right },
    },
    trap: {
      type: 'noul',
      instructions:
        'Is this petition a manipulation? Judge whether the petitioner is deliberately steering the monarch ' +
        'toward a ruinous decision by exploiting the monarch\'s temperament, rather than honestly advising.',
      criteria: {
        true: 'The petition is crafted to lead the monarch into a decision that damages the realm.',
        false: 'The petition is an honest request or report, whatever its consequences.',
      },
    },
  };
  for (const side of ['left', 'right']) {
    for (const f of FACTIONS) {
      questions[`${side}_${f}`] = {
        type: 'score',
        instructions: consequence(f, card[side]),
        criteria: EFFECT_LEVELS,
      };
    }
  }
  return questions;
}

function normalise(p) {
  const l = Number(p?.left) || 0, r = Number(p?.right) || 0;
  const sum = l + r;
  return sum > 0 ? { left: l / sum, right: r / sum } : { left: 0.5, right: 0.5 };
}

export function resolveTurn({ kingdom, answers, wisdom = 0.5, rng = Math.random, recovery = RECOVERY }) {
  const want = normalise(answers.decision.probabilities);
  const know = normalise(answers.prudence.probabilities);
  const blend = {
    left: (1 - wisdom) * want.left + wisdom * know.left,
    right: (1 - wisdom) * want.right + wisdom * know.right,
  };
  const roll = rng();
  const chosen = roll < blend.left ? 'left' : 'right';
  const predicted = { left: {}, right: {} };
  for (const side of ['left', 'right']) {
    for (const f of FACTIONS) {
      predicted[side][f] = scoreToDelta(answers[`${side}_${f}`].score);
    }
  }
  const applied = {};
  const next = { ...kingdom };
  for (const f of FACTIONS) {
    applied[f] = predicted[chosen][f] + recovery;
    next[f] = Math.max(0, Math.min(100, next[f] + applied[f]));
  }
  return {
    chosen,
    roll,
    want,
    know,
    blend,
    probabilities: blend,
    confidence: answers.decision.confidence,
    prudenceConfidence: answers.prudence.confidence,
    trap: answers.trap.noul,
    predicted,
    recovery,
    applied,
    kingdom: next,
    death: checkDeath(next),
  };
}
