# A real turn, call by call

One turn played against the real model, with both requests as sent, both responses as returned, and
every number the game derived from them. Nothing here is abridged by hand: this page is generated
from the stored record, and the two files it came from are next to it.

- [`examples/turn-record.json`](examples/turn-record.json): the record exactly as the chronicle
  stores it, `calls` included (11,739 bytes).
- [`examples/turn-response.json`](examples/turn-response.json): what `POST /api/turn` returned to
  the page.

| | |
| --- | --- |
| Model | `jev-1.13.0` (requested as `jev-latest`) |
| When | 2026-09-20T01:49:47.859Z |
| Latency | forecast 444 ms + advisor 338 ms |
| Tokens | 1926 + 747 = 2673 input |
| Record | `v: 3`, prompt variant `calm`, step 12, recovery 1 |

**How it was made.** A local server on the real API key, not the public site, so this staged turn is
not in the public chronicle. The state was chosen to be instructive, not played up to: a vain king
in year 7 with the treasury at 14, shown a card aimed at his vanity that
costs money. Locally the signing key is known, which is the only reason such a state can be set up;
on the public site it cannot (see [Integrity](integrity.md)). The token in the response file is
signed with that throwaway local key.

[A turn](turn.md) explains the mechanics. This page is the same thing with real numbers in it.

## The situation

Aldric III, vain, wisdom 0.4. Year 7. Church 46,
people 58, army 41, treasury 14.

> **The Sculptor:** A statue of Your Majesty, forty feet high, at the harbour mouth. Ships would steer by your face.
>
> Left: **Build it**. Right: **A modest bust**.

The card is deck index 1, tagged `vain`. On a flaw-tagged card the tempting
option is the left one.

## Call one: forecast

### Request

`POST https://api.typesafe.ai/v1/systemone` with `{ model, state, questions }`. The state:

```json
{
  "year": 7,
  "monarch": {
    "name": "Aldric III",
    "temperament": "Vain",
    "description": "Aldric III cannot resist flattery and would rather die than look weak.",
    "wisdom": "Wary: heeds sober counsel about 40% of the time."
  },
  "kingdom": {
    "note": "Each value runs 0 to 100. Reaching either end means the reign ends.",
    "church": 46,
    "people": 58,
    "army": 41,
    "treasury": 14,
    "danger": [
      "treasury is at 14: one more fall ends the reign"
    ]
  },
  "petition": {
    "speaker": "The Sculptor",
    "message": "A statue of Your Majesty, forty feet high, at the harbour mouth. Ships would steer by your face.",
    "options": {
      "left": "Build it",
      "right": "A modest bust"
    }
  }
}
```

`buildState` wrote the `danger` line because the treasury is within 20 of an edge.

Ten questions. The in-character decision:

```json
{
  "decision": {
    "type": "choice",
    "instructions": "You are Aldric III, a monarch who cannot resist flattery and would rather die than look weak. A petitioner has just spoken. Choose as THIS monarch would, in character, driven by their temperament. Do not choose the wise or optimal option; choose the one this monarch would actually pick.",
    "criteria": {
      "left": "Build it",
      "right": "A modest bust"
    }
  }
}
```

The trap reading:

```json
{
  "trap": {
    "type": "noul",
    "instructions": "Is this petition a manipulation? Judge whether the petitioner is deliberately steering the monarch toward a ruinous decision by exploiting the monarch's temperament, rather than honestly advising.",
    "criteria": {
      "true": "The petition is crafted to lead the monarch into a decision that damages the realm.",
      "false": "The petition is an honest request or report, whatever its consequences."
    }
  }
}
```

And eight forecasts, one per option and faction. They differ only in the faction described and the
option named. This is `left_treasury`:

```json
{
  "left_treasury": {
    "type": "score",
    "instructions": "As a neutral chronicler, predict what happens to the royal treasury over the next year if the monarch chooses \"Build it\". Most decisions change little: \"Unchanged\" is the usual answer. Mark a fall only when this choice clearly costs them, and a rise only when it clearly benefits them. A choice can help one faction while hurting another.",
    "criteria": [
      "Collapses: a severe blow, a large loss",
      "Falls: a clear but survivable loss",
      "Unchanged: no meaningful effect",
      "Rises: a clear gain",
      "Surges: a large, decisive gain"
    ]
  }
}
```

### Response

The three kinds of answer, as returned. A `choice`:

```json
{
  "decision": {
    "type": "choice",
    "choice": "left",
    "confidence": 1,
    "probabilities": {
      "left": 1,
      "right": 0
    }
  }
}
```

A `noul`, the probability that the statement is true:

```json
{
  "trap": {
    "type": "noul",
    "noul": 0.83
  }
}
```

A `score`, a continuous value on the rubric plus the probability of each level:

```json
{
  "left_treasury": {
    "type": "score",
    "score": 0.09,
    "confidence": 0.93,
    "legend": {
      "0": "Collapses: a severe blow, a large loss",
      "1": "Falls: a clear but survivable loss",
      "2": "Unchanged: no meaningful effect",
      "3": "Rises: a clear gain",
      "4": "Surges: a large, decisive gain"
    },
    "probabilities": {
      "0": 0.92,
      "1": 0.08,
      "2": 0,
      "3": 0,
      "4": 0
    }
  }
}
```

All eight forecasts (levels: 0 collapses, 1 falls, 2 unchanged, 3 rises, 4 surges):

| Question | Option | Score | Confidence | P(0) | P(1) | P(2) | P(3) | P(4) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `left_church` | Build it | 1.16 | 0.63 | 0.14 | 0.58 | 0.27 | 0.01 | 0 |
| `left_people` | Build it | 0.68 | 0.64 | 0.37 | 0.59 | 0.03 | 0.01 | 0 |
| `left_army` | Build it | 0.99 | 0.77 | 0.15 | 0.72 | 0.13 | 0 | 0 |
| `left_treasury` | Build it | 0.09 | 0.93 | 0.92 | 0.08 | 0 | 0 | 0 |
| `right_church` | A modest bust | 2.21 | 0.67 | 0 | 0.09 | 0.61 | 0.3 | 0 |
| `right_people` | A modest bust | 2.53 | 0.6 | 0 | 0.06 | 0.35 | 0.59 | 0 |
| `right_army` | A modest bust | 2.03 | 0.72 | 0 | 0.15 | 0.67 | 0.18 | 0 |
| `right_treasury` | A modest bust | 2.63 | 0.67 | 0.01 | 0.03 | 0.29 | 0.66 | 0.01 |

Usage:

```json
{
  "input_tokens": 1926,
  "output_tokens": 170
}
```

## From scores to points

`scoreToDelta`: a level is worth `EFFECT_STEP` = 12 points either side of 2
("unchanged"), rounded, capped at 24 either way.

| Option | Faction | Score | Arithmetic | Points |
| --- | --- | --- | --- | --- |
| Build it | church | 1.16 | (1.16 - 2) x 12 = -10.08 | -10 |
| Build it | people | 0.68 | (0.68 - 2) x 12 = -15.84 | -16 |
| Build it | army | 0.99 | (0.99 - 2) x 12 = -12.12 | -12 |
| Build it | treasury | 0.09 | (0.09 - 2) x 12 = -22.92 | -23 |
| A modest bust | church | 2.21 | (2.21 - 2) x 12 = 2.52 | +3 |
| A modest bust | people | 2.53 | (2.53 - 2) x 12 = 6.36 | +6 |
| A modest bust | army | 2.03 | (2.03 - 2) x 12 = 0.36 | 0 |
| A modest bust | treasury | 2.63 | (2.63 - 2) x 12 = 7.56 | +8 |

These are the ghost ticks the page draws on each meter before the king commits.

## Call two: advisor

### Request

The same state, with the forecasts from call one added as numbers. This is the whole reason for a
second call: asked in the first one, the advisor could not have seen them.

```json
{
  "forecast": {
    "note": "Predicted change to each kingdom value over the next year, by option.",
    "Build it": {
      "church": "-10",
      "people": "-16",
      "army": "-12",
      "treasury": "-23"
    },
    "A modest bust": {
      "church": "+3",
      "people": "+6",
      "army": "0",
      "treasury": "+8"
    }
  }
}
```

One question. Because a meter is in danger, the instruction names it:

```json
{
  "prudence": {
    "type": "choice",
    "instructions": "You are the monarch's most sober advisor and care only about the realm surviving. The reign ends the moment any kingdom value reaches 0 or 100. Right now: treasury is at 14: one more fall ends the reign. Using the forecast, which option keeps the endangered value away from its edge, even at some cost to the others? Ignore the monarch's temperament entirely.",
    "criteria": {
      "left": "Build it",
      "right": "A modest bust"
    }
  }
}
```

### Response

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "prudence": {
      "type": "choice",
      "choice": "right",
      "confidence": 1,
      "probabilities": {
        "right": 1,
        "left": 0
      }
    }
  },
  "usage": {
    "input_tokens": 747,
    "output_tokens": 33
  }
}
```

## The decision

```
wants  = 1    P(left), from decision in call one
knows  = 0    P(left), from prudence in call two
wisdom = 0.4

blend  = (1 - 0.4) x 1 + 0.4 x 0 = 0.6
roll   = 0.7578670688785527

roll >= blend, so the king takes the right option: "A modest bust"
```

On the page: "rolled 76 against 60".

The forecasts for the chosen option are applied, then every meter gains 1:

| Faction | Before | Forecast for "A modest bust" | Recovery | Applied | After |
| --- | --- | --- | --- | --- | --- |
| church | 46 | +3 | +1 | +4 | 50 |
| people | 58 | +6 | +1 | +7 | 65 |
| army | 41 | 0 | +1 | +1 | 42 |
| treasury | 14 | +8 | +1 | +9 | 23 |

No meter reached an edge, so the reign goes on to year 8. Had the roll gone the other
way, "Build it" would have left the realm at church 37, people 43, army 30, treasury 0.

## How it is summarised

The record, without `calls`. These are the fields the chronicle's statistics read; every one is
derived from the two calls above and none is rounded.

```json
{
  "v": 3,
  "id": "05870091-9df0-449b-883f-fe137ad9b5b3",
  "t": "2026-09-20T01:49:47.859Z",
  "reign": "da8f7240-0417-42ab-94d8-79fd340635ee",
  "mock": false,
  "model": "jev-1.13.0",
  "prompt": "calm",
  "step": 12,
  "recovery": 1,
  "year": 7,
  "king": {
    "name": "Aldric III",
    "flaw": "vain",
    "wisdom": 0.4
  },
  "before": {
    "church": 46,
    "people": 58,
    "army": 41,
    "treasury": 14
  },
  "card": {
    "i": 1,
    "tag": "vain",
    "speaker": "The Sculptor",
    "message": "A statue of Your Majesty, forty feet high, at the harbour mouth. Ships would steer by your face.",
    "left": "Build it",
    "right": "A modest bust"
  },
  "want": 1,
  "know": 0,
  "blend": 0.6,
  "roll": 0.7578670688785527,
  "confidence": 1,
  "prudenceConfidence": 1,
  "trap": 0.83,
  "scores": {
    "left": {
      "church": 1.16,
      "people": 0.68,
      "army": 0.99,
      "treasury": 0.09
    },
    "right": {
      "church": 2.21,
      "people": 2.53,
      "army": 2.03,
      "treasury": 2.63
    }
  },
  "predicted": {
    "left": {
      "church": -10,
      "people": -16,
      "army": -12,
      "treasury": -23
    },
    "right": {
      "church": 3,
      "people": 6,
      "army": 0,
      "treasury": 8
    }
  },
  "chosen": "right",
  "applied": {
    "church": 4,
    "people": 7,
    "army": 1,
    "treasury": 9
  },
  "after": {
    "church": 50,
    "people": 65,
    "army": 42,
    "treasury": 23
  },
  "death": null,
  "latency": {
    "forecast": 444,
    "advisor": 338
  },
  "tokens": 2673
}
```

| Field | From |
| --- | --- |
| `want` | `decision.probabilities.left`, normalised against `right` |
| `know` | `prudence.probabilities.left`, the same way |
| `blend` | `(1 - wisdom) x want + wisdom x know` |
| `roll` | The server's random draw; `chosen` is `left` when `roll < blend` |
| `confidence`, `prudenceConfidence` | The `confidence` of the two choice answers |
| `trap` | `trap.noul` |
| `scores` | The `score` of each of the eight forecasts |
| `predicted` | `scoreToDelta` of each score |
| `applied` | `predicted[chosen]` plus `recovery` |
| `after` | `before` plus `applied`, clamped to 0 to 100 |
| `latency`, `tokens` | Measured around each call; the sum of both calls' `usage.input_tokens` |
| `prompt`, `step`, `recovery` | The tuning constants in force, so old records stay interpretable |

In the chronicle's numbers this one turn counts as: a targeted turn for the vain temperament where
the model wanted the bait (`want` >= 0.5) and the crown did not take it; a
danger turn where the advisor chose the option its own forecasts say is safer, and the crown
followed; a trap reading of 0.83 on a targeted petition; and eight forecasts added to the
forecast level shares, each counted at its nearest level.

## Things to notice

- **The probabilities are extreme.** `wants` is 1 and `knows` is 0, each with
  confidence 1. That is usual for Jev, and it is why the game samples from the blend
  and does not take the most likely option: with these answers, wisdom 0.4 is the whole of the
  uncertainty, and the king takes the statue 60 times in 100.
- **The two calls disagree completely, and both are right.** One was asked what a vain king would
  do, the other what keeps the realm alive. The disagreement is the game.
- **The dice decided.** A roll below 0.6 and the treasury goes from 14 to 0: bankrupt, reign over. The record
  keeps the roll so that either outcome can be traced to the dice and not mistaken for the model's choice.
- **The trap reading is 0.83.** The model was not asked to act on it; it is recorded to see
  whether flaw-targeted petitions read as manipulation more than the rest do.
- **The forecasts are a distribution, not a label.** `left_treasury` is 0.09, not 0: most of the
  weight on "collapses", some on "falls". The continuous score is what becomes points.
