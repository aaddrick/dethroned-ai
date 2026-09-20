# terraform/iam.tf
# Two service accounts, least privilege, additive bindings (google_*_iam_member)
# so nothing managed outside this repo is clobbered.
#
#   web    runs the Cloud Run service: reads its two secrets, connects to Cloud SQL
#   build  runs Cloud Build: pushes images, deploys the service, acts as web

resource "google_service_account" "web" {
  account_id   = "${var.service_name}-web"
  display_name = "Dethrone Cloud Run runtime"
  project      = var.project_id

  depends_on = [google_project_service.apis["iam.googleapis.com"]]
}

resource "google_service_account" "build" {
  account_id   = "${var.service_name}-build"
  display_name = "Dethrone Cloud Build"
  project      = var.project_id

  depends_on = [google_project_service.apis["iam.googleapis.com"]]
}

# ─── web ─────────────────────────────────────────────────────────────────────

resource "google_secret_manager_secret_iam_member" "web_reads_api_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.typesafe_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.web.email}"
}

resource "google_secret_manager_secret_iam_member" "web_reads_db_password" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.db_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.web.email}"
}

# Lets the Cloud Run connector open the socket to the instance.
resource "google_project_iam_member" "web_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.web.email}"
}

# The service is a public demo.
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── build ───────────────────────────────────────────────────────────────────

resource "google_artifact_registry_repository_iam_member" "build_pushes_images" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.app.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.build.email}"
}

resource "google_project_iam_member" "build_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.build.email}"
}

resource "google_project_iam_member" "build_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.build.email}"
}

# Deploying a revision that runs as `web` requires actAs on that account.
resource "google_service_account_iam_member" "build_acts_as_web" {
  service_account_id = google_service_account.web.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.build.email}"
}

# `gcloud builds submit` (manual deploys, terraform/README.md) stages the source
# in this bucket, which gcloud creates on first use; the build account has to
# read it. Trigger-driven builds fetch from GitHub and do not need this.
resource "google_storage_bucket_iam_member" "build_reads_staged_source" {
  bucket = "${var.project_id}_cloudbuild"
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.build.email}"
}
