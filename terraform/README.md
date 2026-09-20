# Dethrone Terraform

Infrastructure for the `dethroned-ai` GCP project (number 502665685866, region `us-east4`). One environment. Modelled on `../flyspacea/terraform` with everything that app does not need removed: no VPC, no Redis, no scheduler. The load balancer and DNS follow `../nonconvexlabs-com/terraform`, which fronts nonconvexlabs.com and aaddrick.com the same way (both live in `ncl-prod`; this project has no org, so it cannot attach to that balancer and gets its own).

What it manages:

| File | Resources |
|------|-----------|
| `apis.tf` | the twelve APIs the stack uses |
| `iam.tf` | `dethrone-web` (runtime) and `dethrone-build` (Cloud Build) service accounts and their bindings; public invoker on the service |
| `registry.tf` | Artifact Registry repo `dethrone` with cleanup policies |
| `secrets.tf` | the `TYPESAFE_API_KEY` secret container (value added with gcloud, never in state) |
| `sql.tf` | Cloud SQL Postgres `dethrone-pg`, the database, user and generated `PGPASSWORD` secret |
| `run.tf` | the Cloud Run service (image ignored, Cloud Build owns it); ingress closes to the balancer when `restrict_ingress` is on |
| `load_balancer.tf` | global static IP, managed certificate, serverless NEG, backend, URL maps (www to apex, HTTP to HTTPS), proxies and forwarding rules; created only when `domain` is set |
| `dns.tf` | the Cloud DNS zone for `domain` with A records for the apex and www |
| `cloudbuild.tf` | the push-to-deploy trigger, created only once `github_repository` is set |

## One-time bootstrap

Billing must be linked first. The state bucket is created by hand because Terraform cannot store its own state before it exists.

```sh
gcloud billing projects link dethroned-ai --billing-account=<BILLING_ACCOUNT_ID>
gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com iam.googleapis.com storage.googleapis.com --project=dethroned-ai
gcloud storage buckets create gs://dethroned-ai-tfstate --project=dethroned-ai --location=us-east4 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://dethroned-ai-tfstate --versioning
```

Then, from the repo root with the key in `.env`:

```sh
infra/bootstrap.sh
```

which runs `terraform init`, imports the four hand-enabled APIs, applies the secret container on its own, adds the key as a version, and applies the rest. Cloud Run rejects a revision whose secret has no version, so the order matters. After that the service exists on Google's hello image at the URL in `terraform output service_url`.

## First deploy

Cloud Build needs the repo linked before the trigger can be created. Cloud Build's GitHub app install is interactive:

```sh
gcloud builds connections create github github-aaddrick --region=us-east4 --project=dethroned-ai
# open the printed URL, install the app on the aaddrick/dethroned-ai repo, then:
gcloud builds repositories create aaddrick-dethroned-ai --remote-uri=https://github.com/aaddrick/dethroned-ai.git --connection=github-aaddrick --region=us-east4 --project=dethroned-ai
```

Put the repository's full resource name in `terraform.tfvars` as `github_repository` and apply; from then on a push to `main` builds and deploys. To deploy by hand before that, or without pushing (the build account must be named, and `.gcloudignore` keeps `infra/` in the upload so the smoke test can run):

```sh
gcloud builds submit --config=infra/cloudbuild.yaml --project=dethroned-ai --region=us-east4 \
  --service-account=projects/dethroned-ai/serviceAccounts/dethrone-build@dethroned-ai.iam.gserviceaccount.com \
  --substitutions=COMMIT_SHA=$(git rev-parse --short HEAD)
```

## Domain

`domain = "dethroned.ai"` in `terraform.tfvars` creates the balancer, the certificate and the Cloud DNS zone. Bringing the name up is three steps, in order:

1. `terraform apply`. The zone exists and `terraform output name_servers` lists its four `ns-cloud-*.googledomains.com` names. The certificate sits in `PROVISIONING` until the name resolves to `terraform output lb_ip`.
2. At Namecheap, Domain List, dethroned.ai, Nameservers: choose Custom DNS and paste the four names. This replaces Namecheap's parking page and its email-forwarding records; the domain has no mail, so nothing is lost. Delegation takes minutes to a few hours; `dig +short dethroned.ai NS` shows when it has moved. The certificate issues within about an hour of that (`gcloud compute ssl-certificates describe dethrone-cert --global --format='value(managed.status)'` reads `ACTIVE`).
3. Once `https://dethroned.ai` answers, set `restrict_ingress = true` and apply. The `*.run.app` URL then returns 403 and only the balancer reaches the service, as with nonconvexlabs.com. Manual deploys must pass `_DOMAIN=dethroned.ai` from then on so the smoke test goes through the balancer (the trigger passes it on its own).

The balancer costs about $18 a month (two forwarding rules); the zone about $0.20. Everything else in it is free at demo traffic. There is no Cloud Armor policy: the app rate-limits per IP in Postgres and a WAF would cost more than the balancer.

## Everyday

```sh
cd terraform
terraform init -backend-config=backends/prod.hcl
terraform plan
terraform apply
```

`terraform.tfvars` holds only non-sensitive values and is committed. `.claude/hooks/check-terraform-fmt.sh` runs `terraform fmt -check` on every edited `.tf` file; fix drift with `terraform fmt -recursive terraform/`.

Runtime knobs (`max_instances`, `per_ip_per_min`, `max_in_flight`, `jev_model`) are variables on the service; change them here, not in the console, or the next apply reverts them.
