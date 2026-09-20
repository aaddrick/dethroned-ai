# Dethrone

A Reigns-style demo where [Jev](https://typesafe.ai) (TypeSafe's System One decision model) is the monarch and you are the court. Pick a petition from a hand of five (or write your own), the model picks a side in under a second, and its own predictions of the fallout are applied to the kingdom. Push any meter to 0 or 100 and the reign ends. Fewer years is a better score.

The model never generates text. Each turn is two `POST /v1/systemone` calls:

1. Ten questions in parallel: `decision` (choice, the in-character pick, "wants"), `trap` (noul, is this petition a manipulation), and `left_*` / `right_*` (score x8, predicted consequence for each faction under each option on a five-level rubric).
2. One question, `prudence` (choice, "knows"): the sober advisor picks the safer option after seeing the numeric forecasts from call one in the state.

The second call exists because questions in one call are answered independently. Asked alongside the forecasts, the advisor protected an endangered meter only 56% of the time; given the forecasts as numbers in a second call, 89% (`scripts/two-call.mjs`).

Each king has a wisdom value (0.15 to 0.85, shown as Reckless / Wary / Shrewd). The final decision is sampled from `(1 - wisdom) * wants + wisdom * knows`, so reckless kings follow their flaw and shrewd kings usually take the advisor's side. The UI shows all three distributions.

## The chronicle

`/eval` is a public ledger of every turn anyone has played: the state the model saw (king, temperament, wisdom, meters, petition), what it wanted, what its advisor knew, the blend the decision was rolled from, the eight forecasts, the trap reading, and what happened. It is a live eval of the model on real play rather than on cached answers:

- how reigns end, by cause and by length
- per temperament: how often the in-character answer favoured the flaw-targeted option (the deck's tagged cards always put the bait first), how often the crown took it, and the same rate on untargeted petitions as a control
- the advisor: on turns with a meter within 20 of an edge, how often the second call picked the option that the model's own forecasts say is safer
- trap reading on targeted, untargeted and player-written petitions
- the live share of each forecast level, per-petition tables, and the petitions where the same temperament answered differently on different plays

Every entry expands into the two calls as they happened: the state as sent, the ten questions of the first call with each answer's full distribution and confidence, the advisor's second call with the forecast it was given, and the arithmetic from wants and knows through the wisdom blend and the actual roll to the applied deltas. `/eval?turn=<id>` is a permalink to one turn, and the game's "Model's last answer" box links to it.

Each record stores the exact request body sent to Jev and the exact response body returned, for both calls (`calls[0]` forecast, `calls[1]` advisor), alongside summary fields for the stats: king, meters before and after, card, `want`, `know`, `blend`, `roll`, `trap`, scores, predicted and applied deltas, death, latency, tokens, and the prompt variant and step in force at the time. Nothing is rounded, so any analysis can be rebuilt from the log. `/api/eval` is the summary as JSON, `/api/eval/turn/<id>` one full record, and `/api/eval/export` every record as JSONL. Player-written petitions are counted but their text and their raw calls are never shown or exported.

Every record is inserted into a Postgres `turns` table when `DATABASE_URL` (or `PGHOST` and friends) is set: `id`, `t`, `reign` and `mock` as columns and the whole record as `jsonb`, so any analysis is a SQL query over the raw material. Each instance pulls the rows the others wrote once a minute, so however many Cloud Run instances serve the game there is one chronicle. The per-IP limit is counted in the same database, so it holds across instances too. Memory keeps a slim copy of every record for the stats (`LOG_MAX`) and the full record for the most recent turns (`LOG_RAW_MEMORY`, 2000); older raw records are read back from the table when a turn is opened. A raw turn is about 8 KB. Without Postgres, records go to `data/log/turns.jsonl` (`LOG_DIR`), which is enough for one process on a laptop. Mock-mode turns are logged but excluded from the public numbers when a real key is configured.

## Run

```sh
cp .env.example .env   # then put your key in it
export TYPESAFE_API_KEY=...
npm start              # http://localhost:3000
```

Without a key the server serves deterministic mock answers so the UI still works (`npm run mock` forces this).

Node 20+. The one dependency is `pg`; the server runs without a database (local file log) and uses Postgres when `DATABASE_URL` is set. For a local Postgres:

```sh
podman run -d --name dethrone-pg -e POSTGRES_USER=dethrone -e POSTGRES_PASSWORD=dethrone -e POSTGRES_DB=dethrone -p 5432:5432 docker.io/library/postgres:17-alpine
DATABASE_URL=postgres://dethrone:dethrone@localhost:5432/dethrone npm run mock
```

The schema is created on start.

## Deploy

GCP project `dethroned-ai`, Cloud Run in `us-east4`, Cloud SQL Postgres, Secret Manager for the key, Cloud Build on push to `main`. All of it is in `terraform/` (see `terraform/README.md` for the one-time bootstrap, linking the GitHub repo, and the dethroned.ai load balancer and DNS zone), and `infra/cloudbuild.yaml` builds the image, pushes it and runs `gcloud run deploy` with the new tag. Terraform owns everything about the service except the image tag.

## Tuning

- `deck.json`: the 96 authored petitions, each tagged with the flaw it plays to (or `any`); the hand deals about 45% flaw-targeted cards, gold-edged in the UI
- `game.js` `EFFECT_STEP` (12), `RECOVERY` (1 point per meter per year), `CONSEQUENCE_VARIANT` (`calm`): chosen from Monte Carlo runs so a random player lasts about 18 years (median) and a ruthless one about 12, with deaths split between the low and high edges
- `scripts/cache-effects.mjs`: asks Jev once per card and flaw (and optionally at edge states) and caches the answers in `data/`
- `scripts/montecarlo.mjs`: plays thousands of reigns against random answers or the cache; `--player cruel` picks the hand card closest to a death, `--prudence derived` replaces the model's advisor answer with one computed from its own forecasts
- `game.js` `FLAWS`: the monarch temperaments the decision prompt is built from
- `server.js` `PER_IP_PER_MIN`, `MAX_IN_FLIGHT`: abuse limits for public deployment
- `stats.js` `summarise`: the chronicle's aggregates, computed from the log; `scripts/` can import it to run the same eval over cached answers
