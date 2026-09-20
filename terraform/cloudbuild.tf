# terraform/cloudbuild.tf
# Push-to-deploy trigger on infra/cloudbuild.yaml. Disabled until the GitHub
# repository is linked through a Cloud Build 2nd-gen connection, which needs a
# one-time interactive install of the Cloud Build GitHub app (see README).

resource "google_cloudbuild_trigger" "deploy" {
  count    = var.github_repository == "" ? 0 : 1
  name     = "deploy-${var.service_name}"
  project  = var.project_id
  location = var.region

  repository_event_config {
    repository = var.github_repository

    push {
      branch = var.deploy_branch
    }
  }

  filename        = "infra/cloudbuild.yaml"
  service_account = google_service_account.build.id

  substitutions = {
    _REGION  = var.region
    _SERVICE = var.service_name
    _IMAGE   = local.image
    _DOMAIN  = var.domain
  }

  depends_on = [google_project_service.apis["cloudbuild.googleapis.com"]]
}
