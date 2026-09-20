# terraform/apis.tf
# APIs Dethrone needs (twelve). disable_on_destroy = false so a destroy does not turn off
# APIs that gcloud or the console still rely on.
#
# cloudresourcemanager, serviceusage, iam and storage were enabled by hand before
# the first apply (Terraform needs them to run at all). Import them once so the
# plan is clean:
#   for a in cloudresourcemanager serviceusage iam storage; do
#     terraform import "google_project_service.apis[\"$a.googleapis.com\"]" "dethroned-ai/$a.googleapis.com"
#   done

locals {
  required_apis = [
    "cloudresourcemanager.googleapis.com", # Terraform itself
    "serviceusage.googleapis.com",         # enabling the rest
    "iam.googleapis.com",                  # service accounts
    "storage.googleapis.com",              # tfstate bucket
    "run.googleapis.com",                  # Cloud Run
    "sqladmin.googleapis.com",             # Cloud SQL
    "artifactregistry.googleapis.com",     # images
    "cloudbuild.googleapis.com",           # deploys
    "secretmanager.googleapis.com",        # TYPESAFE_API_KEY
    "logging.googleapis.com",              # request and app logs
    "compute.googleapis.com",              # the load balancer
    "dns.googleapis.com",                  # the zone Namecheap delegates to
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.required_apis)

  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}
