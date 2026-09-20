# Dethrone

A Reigns-style card game where TypeSafe's Jev (a "System One" decision model) is the monarch and the player is the court. The player plays petitions; the model picks a side in character and forecasts the fallout; the forecasts are applied to four meters (church, people, army, treasury). Any meter at 0 or 100 ends the reign. Fewer years is a better score. It is a public demo of what a decision model can do, and a live eval of the model's calibration and consistency. It will be handed to people to test Jev, so the chronicle is a dataset, not just a page.

## Where things stand (2026-09-19)

- **Live** at https://dethrone-gqekmesp3a-uk.a.run.app on the real model, GCP project `dethroned-ai` (number 502665685866, `us-east4`, no org, billed on the personal account). Verified with a real turn: jev-1.13.0, ~700 ms, record in Cloud SQL.
- **Not done:** the Cloud Build GitHub trigger (needs an interactive GitHub app install, then `github_repository` in `terraform/terraform.tfvars`), and the dethroned.ai domain. The domain is written but not applied: `load_balancer.tf` and `dns.tf` (global load balancer, managed cert, Cloud DNS zone, same shape as nonconvexlabs.com and aaddrick.com in `ncl-prod`) with `domain = "dethroned.ai"` in tfvars. Order: apply, switch Namecheap nameservers to `terraform output name_servers`, wait for the cert, then `restrict_ingress = true` and apply again. Details in `terraform/README.md`, "Domain". The name currently points at a Namecheap parking page. Until the trigger exists, deploy by hand with the `gcloud builds submit` command below.
- **History was flattened to one commit on 2026-09-19** before making the repo public; the GitHub repo is `aaddrick/dethroned-ai`.
- **Decisions already made, do not reopen:** a Laravel 13 port was considered and rejected (heavier, one request per PHP worker, needs a DB anyway); Node stays. Postgres was chosen over the JSONL/GCS log so many instances share one ledger and one rate limit. `../dethrone` is a leftover empty Laravel skeleton from the cancelled port, not part of this project.

## Core principles

- **The model decides, it never writes.** Jev returns typed answers with probabilities. Every word on screen is authored (deck.json, death texts, UI copy). Do not add an LLM to generate text; that would break the premise.
- **Show the model's mind, not just the outcome.** The demo's value is watching probabilities: the Decides bar, ghost ticks for both options on the meters, the trap reading, per-call latency, and the raw answer view. Keep those visible and honest.
- **The decision is a dice roll, and it says so.** The blend for the first option is `(1 - wisdom) * wants + wisdom * knows`; the server draws a random number and picks the first option if the draw is below the blend. The draw is the `roll`, stored in every record and shown next to the blend ("rolled 71 against 28") so a surprising outcome is visibly the dice, not the model. Never replace this with the argmax.
- **Questions in one call are answered independently.** Jev's parallel sampler does not reason across questions. Anything that depends on other answers must be a second call with those answers in the state as numbers, or computed in code from them. This is why a turn is two calls (forecast, then advisor). See `scripts/two-call.mjs`: 56% consistency in one call, 89% with a second call.
- **Balance with data, not vibes.** Tuning constants (`EFFECT_STEP`, `RECOVERY`, `CONSEQUENCE_VARIANT`, deck wording) are chosen by `scripts/montecarlo.mjs` over answers cached by `scripts/cache-effects.mjs`. When you change a prompt or a card, re-cache and re-run before trusting it. Target: a random player lasts ~18 years median, a ruthless one ~12, with deaths split between low and high edges.
- **Prompt wording moves the model a lot.** The "calm" consequence phrasing cut "falls" from 42% to 25% of answers. Treat instructions as tuned parameters and record measurements when changing them.
- **It should feel like a game, not a website.** Dark stage, parchment cards, serif display type, no panels, no emoji, no form chrome. Free-text entry exists but is tucked away. Phone width must work (hand becomes a snap-scroll).
- **One dependency.** Plain Node 20+ with `fetch`, static files, no build step. The only package is `pg`. Do not add more without a strong reason.
- **The key stays server-side.** `TYPESAFE_API_KEY` lives in the gitignored `.env` (loaded with `--env-file-if-exists`) locally and in Secret Manager in production. The server enforces a per-IP limit (counted in Postgres, so it holds across instances) and an in-flight cap (per instance on purpose: it protects the process and the model from a burst).
- **The chronicle is a dataset.** Keep records raw, keep the shape stable (bump `v` when it changes), and prefer SQL over the `jsonb` record for new analysis rather than adding summary columns.

## Layout

- `server.js`: HTTP server, static files, `/api/reign`, `/api/turn` (two Jev calls, then one log record), `/api/eval`, `/api/eval/turn/<id>`, `/api/eval/export`, mock mode when no key, rate limits.
- `game.js`: rules and prompts. Kings, flaws, wisdom, state builder, question builders (`buildQuestions` for call one, `buildAdvisorCall` for call two), effect rubric, deltas, recovery, deaths, `resolveTurn`. Pure, no I/O; the scripts import it.
- `db.js`: the Postgres pool, on when `DATABASE_URL` or `PGHOST` is set (`pg` reads `PG*` on its own but not `DATABASE_URL`, so it is passed explicitly). Creates the schema on start under an advisory lock, because instances start together on Cloud Run and concurrent `CREATE TABLE IF NOT EXISTS` races inside Postgres. Owns the `ip_hits` per-IP counter. Fails loudly if configured but unreachable, so a bad deploy does not run without the ledger.
- `log.js`: the decision log. Each record carries the exact request and response of both Jev calls (`calls`) plus summary fields. Memory holds slim copies of every record for the stats and full records for the last 2,000. Durable copy: the `turns` table (`id`, `t`, `reign`, `mock` as columns, the whole record as `jsonb`, keyset by `seq`), pulled once a minute so instances see each other's turns; `raw(id)` asks Postgres directly so permalinks work before the pull; `all()` streams it for the export. Without Postgres, `data/log/turns.jsonl`.
- `stats.js`: pure aggregates over the slim records for the chronicle (bait rates per flaw, advisor protection on danger turns using the same safer-option rule as `scripts/two-call.mjs`, trap means, forecast level shares, contested cards). `redact` hides player-written petition text.
- `deck.json`: 96 petitions, each tagged with the flaw it plays to or `any`. The hand deals ~45% flaw-targeting cards; they get a gold edge.
- `public/`: `index.html`, `style.css`, `app.js`. Client holds game state; server is stateless apart from the log. `eval.html` and `eval.js` are the chronicle at `/eval`, styled as a ledger in the same stage; every entry expands into both raw calls, and `/eval?turn=<id>` is a permalink.
- `scripts/`: `cache-effects.mjs` (ask Jev per card and flaw, optionally at edge states), `montecarlo.mjs` (thousands of reigns against random or cached answers; `--player cruel`, `--prudence derived`, `--step`, `--recovery`), `two-call.mjs` (the consistency experiment).
- `data/`: cached answers. `effects-calm.json` matches the current prompt; `effects-v1.json` and `effects.json` are the strict prompt on the old and current deck; `edges*.json` are advisor answers at edge states.
- `Dockerfile`: node:22-alpine, `npm ci --omit=dev`, port 8080. `.dockerignore` and `.gcloudignore` match except `.gcloudignore` keeps `infra/`, which the build's smoke step runs from the source upload.
- `terraform/`: everything in `dethroned-ai`. `apis.tf` (twelve APIs), `iam.tf` (`dethrone-web` runtime and `dethrone-build` build accounts, least privilege, plus read on the `dethroned-ai_cloudbuild` staging bucket for manual submits), `registry.tf` (Artifact Registry `dethrone` with cleanup), `secrets.tf` (`TYPESAFE_API_KEY` container; value added with gcloud, never in state), `sql.tf` (Cloud SQL Postgres 17 `dethrone-pg`, db-f1-micro, password generated by Terraform into the `PGPASSWORD` secret), `run.tf` (the service; Terraform owns env, secrets, scaling and the Cloud SQL socket mount but ignores the image and the service-level `scaling` block that `gcloud run deploy` writes back; ingress closes to the balancer when `restrict_ingress` is on), `load_balancer.tf` and `dns.tf` (global external Application Load Balancer, `dethrone-ip`, `dethrone-cert` for the apex and www, serverless NEG, www-to-apex and HTTP-to-HTTPS redirects, Cloud DNS zone `dethrone-zone`; all gated on `domain`, no Cloud Armor), `cloudbuild.tf` (trigger, created once `github_repository` is set). State in `gs://dethroned-ai-tfstate`. `terraform/README.md` has the bootstrap order and the manual link and domain steps.
- `infra/`: `cloudbuild.yaml` (pull cache, build, push `:latest` and `:$COMMIT_SHA`, `gcloud run deploy --image`, smoke test), `smoke-test.sh` (fails if the service is in mock mode; goes through `https://$_DOMAIN` when the substitution is set, which is the only way in once ingress is restricted), `bootstrap.sh` (first apply on a fresh project: secret container, then the key as a version, then everything, because Cloud Run rejects a secret env var with no version).
- `.claude/hooks/check-terraform-fmt.sh`: blocks on `terraform fmt` drift for any edited `.tf` or `.tfvars`.

## Commands

```
npm start                 # real model, reads .env
npm run mock              # deterministic fake answers, no key needed
podman run -d --name dethrone-pg -e POSTGRES_USER=dethrone -e POSTGRES_PASSWORD=dethrone -e POSTGRES_DB=dethrone -p 5432:5432 docker.io/library/postgres:17-alpine
DATABASE_URL=postgres://dethrone:dethrone@localhost:5432/dethrone npm run mock   # against that Postgres; schema is created on start
podman build -t dethroned . && podman run --rm -p 8080:8080 -e JEV_MOCK=1 dethroned
node scripts/montecarlo.mjs --n 3000 --cache data/effects-calm.json --edges data/edges-danger.json --player cruel --step 12 --recovery 1
node --env-file=.env scripts/cache-effects.mjs --out data/effects-calm.json
node --env-file=.env scripts/two-call.mjs --mode numbers

cd terraform && terraform init -backend-config=backends/prod.hcl && terraform plan   # plan is clean as of 2026-09-19
gcloud builds submit --config=infra/cloudbuild.yaml --project=dethroned-ai --region=us-east4 --service-account=projects/dethroned-ai/serviceAccounts/dethrone-build@dethroned-ai.iam.gserviceaccount.com --substitutions=COMMIT_SHA=$(git rev-parse --short HEAD),_DOMAIN=dethroned.ai   # deploy by hand (~1 min); drop _DOMAIN until the domain is live
gcloud run services logs read dethrone --region=us-east4 --project=dethroned-ai --limit=50
gcloud sql connect dethrone-pg --user=dethrone --project=dethroned-ai   # password: gcloud secrets versions access latest --secret=PGPASSWORD --project=dethroned-ai
```

`gcloud config` defaults to `dethroned-ai` and the personal Google account. Application Default Credentials are set up for Terraform.

## Jev API facts

- `POST https://api.typesafe.ai/v1/systemone`, bearer auth, body `{ model, state, questions }`. Question types: `choice` (map of labels to descriptions), `score` (ordered list of 2 to 10 levels; answer is a continuous score plus per-level probabilities), `noul` (yes/no probability). Choice and score answers carry `confidence`.
- Limits: 64k tokens per call, 255 choice options, text only, 1,200 requests per minute. Latency 70 to 500 ms per call. Input $0.042 per million tokens, output free. A two-call turn is ~2,700 input tokens; a dollar is roughly 450 games.
- Probabilities are often extreme (1.0 / 0.0). The game samples from the wisdom-weighted blend of the in-character answer and the advisor's answer rather than taking the argmax, so wisdom is a real probability.

## Production facts

- Cloud Run: max 3 instances, 80 concurrent requests each, 512Mi, scale to zero, 60 s timeout, public. The Jev limit of 1,200 requests a minute (600 turns) is the real ceiling. Change knobs in `terraform/variables.tf`, not the console, or the next apply reverts them.
- Cloud SQL reached through Cloud Run's built-in connection: `PGHOST=/cloudsql/dethroned-ai:us-east4:dethrone-pg`, no VPC, no proxy sidecar. `deletion_protection` is on; a deleted instance name is reserved for a week.
- Cost: roughly $8 to $10 a month for the database, about $18 for the load balancer's two forwarding rules once applied, near zero for the rest at demo traffic.
- The load balancer is a copy of the one in `ncl-prod` that fronts nonconvexlabs.com and aaddrick.com (both are Cloud Run services in that one project; the personal `aaddrickcom` project is empty). `dethroned-ai` has no org, and cross-project backends need Shared VPC in one org, so it cannot join that balancer.
- A build that comes up in mock mode fails its smoke test: that means the key is not reaching the container. Check the secret version and the `web_reads_api_key` binding first.
- `/api/eval` includes `log: { store, loaded, errors, lastError }`; `store` should read `postgres` in production. If the chronicle looks empty after a deploy, look there first.

## Conventions

- Commit only when asked. Stage as you go.
- Verify UI changes in a real browser at desktop and ~400px widths before calling them done.
- When testing against the API, remember the server's per-IP limit (30 turns per minute by default); scripts should call the API directly.
- Do not write emoji anywhere in the UI. Use text or plain SVG.
- The chronicle is public. Never show or export player-written petition text or the raw calls that quote it (`redact` in stats.js); deck cards are authored and fine.
- Record everything raw. When adding a question or a call, keep the request and response untouched in `calls`; derive summary fields from them rather than storing rounded values. Bump the record's `v` if the shape changes. Mock turns are logged with `mock: true` and excluded from the public numbers when a real key is set.
- Deck convention the eval relies on: on flaw-tagged cards the tempting option is `left`. Keep it that way when adding cards.
- Keep the README's numbers in sync with the latest simulation when tuning changes.
- Terraform: run `terraform fmt -recursive terraform/` before finishing; keep values out of state (secret values are added with gcloud); `terraform.tfvars` is committed and holds nothing sensitive.
- In shell scripts under `set -o pipefail`, do not pipe `curl` into `grep -q`; capture the body first (curl exits 23 when grep closes the pipe).
