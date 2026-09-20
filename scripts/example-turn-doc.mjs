// Writes docs/example-turn.md from docs/examples/turn-record.json, so the page never drifts from the
// record it describes. Run from the repo root: node scripts/example-turn-doc.mjs
//
// To refresh the record itself: run a local server on the real key with a known STATE_SECRET, sign a
// state with it, POST one turn, and save GET /api/eval/turn/<id> as turn-record.json and the turn's
// response as turn-response.json. Not the public site: a staged turn does not belong in the chronicle.
import fs from 'node:fs';
import { FACTIONS, EFFECT_STEP, RECOVERY, scoreToDelta } from '../game.js';
const r = JSON.parse(fs.readFileSync('docs/examples/turn-record.json', 'utf8'));

const [one, two] = r.calls;
const A = one.response.answers, Q = one.request.questions;
const j = (o) => '```json\n' + JSON.stringify(o, null, 2) + '\n```';
const sign = (n) => (n > 0 ? `+${n}` : String(n));
const { calls, ...summary } = r;
const chosenLabel = r.card[r.chosen];

const forecastRows = ['left', 'right'].flatMap((side) => FACTIONS.map((f) => {
  const a = A[`${side}_${f}`];
  const p = [0, 1, 2, 3, 4].map((k) => a.probabilities[k] ?? a.probabilities[String(k)]);
  return `| \`${side}_${f}\` | ${r.card[side]} | ${a.score} | ${a.confidence} | ${p.join(' | ')} |`;
})).join('\n');

const deltaRows = ['left', 'right'].flatMap((side) => FACTIONS.map((f) => {
  const s = A[`${side}_${f}`].score;
  return `| ${r.card[side]} | ${f} | ${s} | (${s} - 2) x ${EFFECT_STEP} = ${((s - 2) * EFFECT_STEP).toFixed(2)} | ${sign(scoreToDelta(s))} |`;
})).join('\n');

const appliedRows = FACTIONS.map((f) => `| ${f} | ${r.before[f]} | ${sign(r.predicted[r.chosen][f])} | +${RECOVERY} | ${sign(r.applied[f])} | ${r.after[f]} |`).join('\n');
const otherSide = r.chosen === 'left' ? 'right' : 'left';
const wouldBe = FACTIONS.map((f) => `${f} ${Math.max(0, Math.min(100, r.before[f] + r.predicted[otherSide][f] + RECOVERY))}`).join(', ');

const md = `# A real turn, call by call

One turn played against the real model, with both requests as sent, both responses as returned, and
every number the game derived from them. Nothing here is abridged by hand: this page is generated
from the stored record, and the two files it came from are next to it.

- [\`examples/turn-record.json\`](examples/turn-record.json): the record exactly as the chronicle
  stores it, \`calls\` included (${JSON.stringify(r).length.toLocaleString('en-US')} bytes).
- [\`examples/turn-response.json\`](examples/turn-response.json): what \`POST /api/turn\` returned to
  the page.

| | |
| --- | --- |
| Model | \`${r.model}\` (requested as \`${one.request.model}\`) |
| When | ${r.t} |
| Latency | forecast ${r.latency.forecast} ms + advisor ${r.latency.advisor} ms |
| Tokens | ${one.response.usage.input_tokens} + ${two.response.usage.input_tokens} = ${r.tokens} input |
| Record | \`v: ${r.v}\`, prompt variant \`${r.prompt}\`, step ${r.step}, recovery ${r.recovery} |

**How it was made.** A local server on the real API key, not the public site, so this staged turn is
not in the public chronicle. The state was chosen to be instructive, not played up to: a vain king
in year ${r.year} with the treasury at ${r.before.treasury}, shown a card aimed at his vanity that
costs money. Locally the signing key is known, which is the only reason such a state can be set up;
on the public site it cannot (see [Integrity](integrity.md)). The token in the response file is
signed with that throwaway local key.

[A turn](turn.md) explains the mechanics. This page is the same thing with real numbers in it.

## The situation

${r.king.name}, ${r.king.flaw}, wisdom ${r.king.wisdom}. Year ${r.year}. Church ${r.before.church},
people ${r.before.people}, army ${r.before.army}, treasury ${r.before.treasury}.

> **${r.card.speaker}:** ${r.card.message}
>
> Left: **${r.card.left}**. Right: **${r.card.right}**.

The card is deck index ${r.card.i}, tagged \`${r.card.tag}\`. On a flaw-tagged card the tempting
option is the left one.

## Call one: forecast

### Request

\`POST https://api.typesafe.ai/v1/systemone\` with \`{ model, state, questions }\`. The state:

${j(one.request.state)}

\`buildState\` wrote the \`danger\` line because the treasury is within 20 of an edge.

Ten questions. The in-character decision:

${j({ decision: Q.decision })}

The trap reading:

${j({ trap: Q.trap })}

And eight forecasts, one per option and faction. They differ only in the faction described and the
option named. This is \`left_treasury\`:

${j({ left_treasury: Q.left_treasury })}

### Response

The three kinds of answer, as returned. A \`choice\`:

${j({ decision: A.decision })}

A \`noul\`, the probability that the statement is true:

${j({ trap: A.trap })}

A \`score\`, a continuous value on the rubric plus the probability of each level:

${j({ left_treasury: A.left_treasury })}

All eight forecasts (levels: 0 collapses, 1 falls, 2 unchanged, 3 rises, 4 surges):

| Question | Option | Score | Confidence | P(0) | P(1) | P(2) | P(3) | P(4) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${forecastRows}

Usage:

${j(one.response.usage)}

## From scores to points

\`scoreToDelta\`: a level is worth \`EFFECT_STEP\` = ${EFFECT_STEP} points either side of 2
("unchanged"), rounded, capped at ${2 * EFFECT_STEP} either way.

| Option | Faction | Score | Arithmetic | Points |
| --- | --- | --- | --- | --- |
${deltaRows}

These are the ghost ticks the page draws on each meter before the king commits.

## Call two: advisor

### Request

The same state, with the forecasts from call one added as numbers. This is the whole reason for a
second call: asked in the first one, the advisor could not have seen them.

${j({ forecast: two.request.state.forecast })}

One question. Because a meter is in danger, the instruction names it:

${j(two.request.questions)}

### Response

${j(two.response)}

## The decision

\`\`\`
wants  = ${r.want}    P(left), from decision in call one
knows  = ${r.know}    P(left), from prudence in call two
wisdom = ${r.king.wisdom}

blend  = (1 - ${r.king.wisdom}) x ${r.want} + ${r.king.wisdom} x ${r.know} = ${r.blend}
roll   = ${r.roll}

roll ${r.roll < r.blend ? '<' : '>='} blend, so the king takes the ${r.chosen} option: "${chosenLabel}"
\`\`\`

On the page: "rolled ${Math.round(r.roll * 100)} against ${Math.round(r.blend * 100)}".

The forecasts for the chosen option are applied, then every meter gains ${RECOVERY}:

| Faction | Before | Forecast for "${chosenLabel}" | Recovery | Applied | After |
| --- | --- | --- | --- | --- | --- |
${appliedRows}

${r.death ? `The reign ended: ${r.death.faction} at the ${r.death.edge} edge.` : `No meter reached an edge, so the reign goes on to year ${r.year + 1}.`} Had the roll gone the other
way, "${r.card[otherSide]}" would have left the realm at ${wouldBe}.

## How it is summarised

The record, without \`calls\`. These are the fields the chronicle's statistics read; every one is
derived from the two calls above and none is rounded.

${j(summary)}

| Field | From |
| --- | --- |
| \`want\` | \`decision.probabilities.left\`, normalised against \`right\` |
| \`know\` | \`prudence.probabilities.left\`, the same way |
| \`blend\` | \`(1 - wisdom) x want + wisdom x know\` |
| \`roll\` | The server's random draw; \`chosen\` is \`left\` when \`roll < blend\` |
| \`confidence\`, \`prudenceConfidence\` | The \`confidence\` of the two choice answers |
| \`trap\` | \`trap.noul\` |
| \`scores\` | The \`score\` of each of the eight forecasts |
| \`predicted\` | \`scoreToDelta\` of each score |
| \`applied\` | \`predicted[chosen]\` plus \`recovery\` |
| \`after\` | \`before\` plus \`applied\`, clamped to 0 to 100 |
| \`latency\`, \`tokens\` | Measured around each call; the sum of both calls' \`usage.input_tokens\` |
| \`prompt\`, \`step\`, \`recovery\` | The tuning constants in force, so old records stay interpretable |

In the chronicle's numbers this one turn counts as: a targeted turn for the vain temperament where
the model wanted the bait (\`want\` >= 0.5) and the crown ${r.chosen === 'left' ? 'took it' : 'did not take it'}; a
danger turn where the advisor ${r.know < 0.5 ? 'chose' : 'did not choose'} the option its own forecasts say is safer, and the crown
${r.chosen === 'right' ? 'followed' : 'did not follow'}; a trap reading of ${r.trap} on a targeted petition; and eight forecasts added to the
forecast level shares, each counted at its nearest level.

## Things to notice

- **The probabilities are extreme.** \`wants\` is ${r.want} and \`knows\` is ${r.know}, each with
  confidence ${r.confidence}. That is usual for Jev, and it is why the game samples from the blend
  and does not take the most likely option: with these answers, wisdom ${r.king.wisdom} is the whole of the
  uncertainty, and the king takes the statue ${Math.round(r.blend * 100)} times in 100.
- **The two calls disagree completely, and both are right.** One was asked what a vain king would
  do, the other what keeps the realm alive. The disagreement is the game.
- **The dice decided.** A roll below ${r.blend} and the treasury goes from ${r.before.treasury} to ${Math.max(0, r.before.treasury + r.predicted.left.treasury + RECOVERY)}: bankrupt, reign over. The record
  keeps the roll so that either outcome can be traced to the dice and not mistaken for the model's choice.
- **The trap reading is ${r.trap}.** The model was not asked to act on it; it is recorded to see
  whether flaw-targeted petitions read as manipulation more than the rest do.
- **The forecasts are a distribution, not a label.** \`left_treasury\` is ${A.left_treasury.score}, not 0: most of the
  weight on "collapses", some on "falls". The continuous score is what becomes points.
`;
fs.writeFileSync('docs/example-turn.md', md);
console.log(md.split('\n').length, 'lines');
