#!/usr/bin/env bash
# Post-deploy check: the new revision serves the game, the chronicle summary,
# and is on the real model (not mock). Usage: smoke-test.sh SERVICE REGION [DOMAIN]
# With DOMAIN the checks go through the load balancer at https://DOMAIN, which is
# the only way in once Cloud Run ingress is restricted to it. Without it they hit
# the *.run.app URL.
set -euo pipefail

service=${1:?service}
region=${2:?region}
domain=${3:-}
run_url=$(gcloud run services describe "$service" --region="$region" --format='value(status.url)')
url=$run_url
if [[ -n "$domain" ]]; then
  # The domain is the real front door, but its certificate takes up to an hour
  # after DNS delegation to issue and TLS fails until then. While Cloud Run
  # ingress is still open, fall back to the *.run.app URL rather than fail a
  # deploy on a provisioning certificate; once ingress is restricted the
  # fallback returns 403 and the test fails, as it should.
  if curl -fsS --max-time 20 -o /dev/null "https://$domain/api/eval"; then
    url="https://$domain"
  else
    echo "WARN: https://$domain is not answering (certificate still provisioning?); testing $run_url instead" >&2
  fi
fi
echo "Smoke testing $url"

# Bodies go through variables: with pipefail, `curl | grep -q` fails with curl
# exit 23 when grep closes the pipe on the first match.
html=$(curl -fsS --max-time 20 "$url/")
grep -q '<title>Dethrone</title>' <<< "$html"
echo "ok  /"

eval_json=$(curl -fsS --max-time 20 "$url/api/eval")
echo "ok  /api/eval"

if grep -q '"mock":true' <<< "$eval_json"; then
  echo "FAIL: service is in mock mode; TYPESAFE_API_KEY is not reaching the container" >&2
  exit 1
fi
echo "ok  real model"

if grep -q '"lastError":"' <<< "$eval_json"; then
  echo "WARN: decision log reports an error: $(grep -o '"lastError":"[^"]*"' <<< "$eval_json")" >&2
fi

reign=$(curl -fsS --max-time 20 "$url/api/reign")
grep -q '"deck"' <<< "$reign"
echo "ok  /api/reign"
