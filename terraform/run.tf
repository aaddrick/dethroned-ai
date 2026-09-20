# terraform/run.tf
# The Cloud Run service. Terraform owns everything about it except the image:
# Cloud Build deploys new images with `gcloud run deploy --image`, and the
# ignore_changes below keeps Terraform from rolling that back. Everything else
# (env, secrets, scaling, service account) is changed here and applied.
#
# The first apply uses Google's hello image so the service exists before any
# build has run. The first Cloud Build replaces it.

resource "google_cloud_run_v2_service" "app" {
  name     = var.service_name
  location = var.region
  project  = var.project_id
  ingress  = var.domain != "" && var.restrict_ingress ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"

  deletion_protection = false

  template {
    service_account = google_service_account.web.email

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    max_instance_request_concurrency = var.container_concurrency
    timeout                          = "60s"

    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "JEV_MODEL"
        value = var.jev_model
      }
      # Postgres over the Cloud SQL socket. pg reads PG* from the environment.
      env {
        name  = "PGHOST"
        value = "/cloudsql/${google_sql_database_instance.db.connection_name}"
      }
      env {
        name  = "PGUSER"
        value = google_sql_user.app.name
      }
      env {
        name  = "PGDATABASE"
        value = google_sql_database.app.name
      }
      env {
        name = "PGPASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }
      # Cloud Run's filesystem is in-memory and per instance; Postgres is the
      # durable copy, so the local file is off.
      env {
        name  = "LOG_DIR"
        value = ""
      }
      env {
        name  = "PER_IP_PER_MIN"
        value = tostring(var.per_ip_per_min)
      }
      env {
        name  = "MAX_IN_FLIGHT"
        value = tostring(var.max_in_flight)
      }
      env {
        name = "TYPESAFE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.typesafe_api_key.secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      startup_probe {
        http_get {
          path = "/api/eval"
          port = 8080
        }
        initial_delay_seconds = 2
        period_seconds        = 5
        timeout_seconds       = 3
        failure_threshold     = 6
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.db.connection_name]
      }
    }
  }

  labels = {
    project     = var.service_name
    environment = var.environment
    managed_by  = "terraform"
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      # `gcloud run deploy` writes a service-level scaling block back; the
      # template's scaling above is the one that matters.
      scaling,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_secret_manager_secret_iam_member.web_reads_api_key,
    google_secret_manager_secret_iam_member.web_reads_db_password,
    google_secret_manager_secret_version.db_password,
    google_project_iam_member.web_cloudsql_client,
  ]
}
