#!/usr/bin/env bash
# First-time apply for a fresh project. Assumes billing is linked and the state
# bucket exists (terraform/README.md, "One-time bootstrap"). Idempotent: safe to
# rerun after a partial failure.
set -euo pipefail
cd "$(dirname "$0")/../terraform"

project=dethroned-ai
key=$(grep -E '^TYPESAFE_API_KEY=' ../.env | cut -d= -f2- || true)
if [[ -z "$key" ]]; then
  echo "TYPESAFE_API_KEY not found in ../.env" >&2
  exit 1
fi

terraform init -backend-config=backends/prod.hcl -input=false

# APIs enabled by hand before Terraform could run. Ignore "already managed".
for a in cloudresourcemanager serviceusage iam storage; do
  terraform import -input=false "google_project_service.apis[\"$a.googleapis.com\"]" "$project/$a.googleapis.com" 2>/dev/null || true
done

# The service refuses a secret env var with no version, so the container comes
# first, then a version, then everything else.
terraform apply -input=false -auto-approve -target=google_secret_manager_secret.typesafe_api_key
if ! gcloud secrets versions list TYPESAFE_API_KEY --project="$project" --filter='state=enabled' --format='value(name)' | grep -q .; then
  printf '%s' "$key" | gcloud secrets versions add TYPESAFE_API_KEY --project="$project" --data-file=-
fi

terraform apply -input=false
terraform output
