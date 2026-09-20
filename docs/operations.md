# Operations

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/release-dark.svg">
  <img alt="A release: work lands on main, deploy-prod is fast-forwarded and pushed, the Cloud Build trigger builds and pushes the image, deploys a new revision, and the smoke test checks it through the domain" src="diagrams/release-light.svg">
</picture>

## Releasing

`main` is for work. A release is a fast-forward of `deploy-prod`:

```sh
git push origin main
git branch -f deploy-prod main && git push origin deploy-prod
```

The push fires the Cloud Build trigger `deploy-dethrone`, which runs `infra/cloudbuild.yaml`: build
the image, push `:latest` and `:$COMMIT_SHA`, `gcloud run deploy` with the new tag, then
`infra/smoke-test.sh` through `https://dethroned.ai`. The smoke test fails if the service came up in
mock mode, which means the API key did not reach the container. A build takes about a minute.

A page that was open across a release that changed the shape of a turn is told to reload.

## Terraform

Terraform owns everything about the service except the image tag: env vars, secrets, scaling, the
database, the balancer, DNS, the trigger. Change limits and scaling in `terraform/variables.tf` and
apply; a change made in the console is reverted by the next apply. An apply that only changes env
vars rolls a new revision on the current image, with no release needed.

```sh
cd terraform && terraform init -backend-config=backends/prod.hcl && terraform plan
```

If a change adds a secret or an env var the server requires, apply before releasing: the server
refuses to start on Cloud Run without `STATE_SECRET`. `terraform/README.md` has the bootstrap order
for a fresh project and the domain steps.

## Running it locally

```sh
npm run mock                      # fake answers, no key: http://localhost:3000
npm start                         # the real model, key in .env
```

For the Postgres paths (the unique index, replays, the shared counters):

```sh
podman run -d --name dethrone-pg -e POSTGRES_USER=dethrone -e POSTGRES_PASSWORD=dethrone \
  -e POSTGRES_DB=dethrone -p 5432:5432 docker.io/library/postgres:17-alpine
DATABASE_URL=postgres://dethrone:dethrone@localhost:5432/dethrone npm run mock
```

Check page changes in a real browser at desktop width and at about 400 px.

## When something looks wrong

| Symptom | Look at |
| --- | --- |
| The build fails its smoke test in mock mode | The `TYPESAFE_API_KEY` secret version and the `web_reads_api_key` binding |
| The chronicle looks empty after a deploy | `log` in `/api/eval`: `store` should be `postgres`, `errors` 0 |
| Every turn says the reign is not remembered | `STATE_SECRET` differs between instances, or was rotated |
| Everyone is rate limited together | `XFF_FROM_RIGHT` is wrong for the path in front of the service; `ip_hits` should hold visitors' own addresses |
| The king is silent | `gcloud run services logs read dethrone --region=us-east4 --project=dethroned-ai --limit=50` for the Jev error |

To read the database:

```sh
cloud-sql-proxy --port 9471 dethroned-ai:us-east4:dethrone-pg &
PGPASSWORD=$(gcloud secrets versions access latest --secret=PGPASSWORD --project=dethroned-ai) \
  psql -h 127.0.0.1 -p 9471 -U dethrone -d dethrone
```

## Cost

About $8 to $10 a month for the database and $18 for the balancer's two forwarding rules. The model
and Cloud Run are close to nothing at demo traffic.
