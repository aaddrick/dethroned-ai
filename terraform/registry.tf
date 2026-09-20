# terraform/registry.tf
# One Docker repository. Cloud Build pushes :latest and :<commit sha>.
# Keep rules union: :latest and the five newest tagged images survive; untagged
# layers older than a week are deleted.

resource "google_artifact_registry_repository" "app" {
  repository_id = var.service_name
  format        = "DOCKER"
  location      = var.region
  project       = var.project_id
  description   = "Dethrone application images"

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-latest-tag"
    action = "KEEP"
    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["latest"]
    }
  }

  cleanup_policies {
    id     = "keep-5-most-recent-tagged"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  cleanup_policies {
    id     = "delete-untagged-older-7-days"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"
    }
  }

  labels = {
    project     = var.service_name
    environment = var.environment
    managed_by  = "terraform"
  }

  depends_on = [google_project_service.apis["artifactregistry.googleapis.com"]]
}
