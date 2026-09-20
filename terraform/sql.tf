# terraform/sql.tf
# Cloud SQL Postgres for the chronicle and the per-IP limit. The service reaches
# it through Cloud Run's built-in Cloud SQL connection (a unix socket under
# /cloudsql, see run.tf), so the instance needs no VPC, no proxy sidecar and no
# authorised networks: the public IP only answers to the connector, which
# authenticates as the web service account (roles/cloudsql.client, iam.tf).
#
# Smallest tier. db-f1-micro is a shared core with no SLA, which is right for a
# demo; bump sql_tier for a launch. Deleting the instance keeps its name reserved
# for a week, hence deletion_protection.
#
# Password auth. The password is generated here and lands in state (the state
# bucket is private and versioned) and in Secret Manager for the service. IAM
# database auth would avoid that but needs a GRANT run by hand on first setup.

resource "google_sql_database_instance" "db" {
  name             = "${var.service_name}-pg"
  project          = var.project_id
  region           = var.region
  database_version = "POSTGRES_17"

  deletion_protection = true

  settings {
    tier              = var.sql_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "07:00"
      point_in_time_recovery_enabled = false
      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day  = 7
      hour = 8
    }

    user_labels = {
      project     = var.service_name
      environment = var.environment
      managed_by  = "terraform"
    }
  }

  depends_on = [google_project_service.apis["sqladmin.googleapis.com"]]
}

resource "google_sql_database" "app" {
  name     = var.service_name
  project  = var.project_id
  instance = google_sql_database_instance.db.name
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  name     = var.service_name
  project  = var.project_id
  instance = google_sql_database_instance.db.name
  password = random_password.db.result
}

resource "google_secret_manager_secret" "db_password" {
  project   = var.project_id
  secret_id = "PGPASSWORD"

  annotations = {
    description = "Cloud SQL password for the ${var.service_name} database user"
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

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db.result
}
