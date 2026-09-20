# terraform/secrets.tf
# Secret containers only. Values never enter state. Add the value with:
#   gcloud secrets versions add TYPESAFE_API_KEY --project=dethroned-ai --data-file=<(printf '%s' "$KEY")
#
# Cloud Run refuses a revision whose secret env var has no version, so on a fresh
# project the secret must get a version between creating it and creating the
# service. infra/bootstrap.sh does that with a targeted apply.

resource "google_secret_manager_secret" "typesafe_api_key" {
  project   = var.project_id
  secret_id = "TYPESAFE_API_KEY"

  annotations = {
    description = "Bearer token for api.typesafe.ai (Jev)"
  }

  labels = {
    project     = var.service_name
    environment = var.environment
    managed_by  = "terraform"
  }

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

# The key the server signs reign state with (STATE_SECRET in server.js). Unlike the API key it is
# ours to make up, so Terraform generates it, the same way as the database password. Every instance
# must share it; rotating it ends the reigns in progress and nothing else.
resource "random_password" "state_secret" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "state_secret" {
  project   = var.project_id
  secret_id = "STATE_SECRET"

  annotations = {
    description = "HMAC key for the signed reign state the client carries between turns"
  }

  labels = {
    project     = var.service_name
    environment = var.environment
    managed_by  = "terraform"
  }

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "state_secret" {
  secret      = google_secret_manager_secret.state_secret.id
  secret_data = random_password.state_secret.result
}
