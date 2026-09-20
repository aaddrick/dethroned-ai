locals {
  image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/${var.service_name}"
}

output "service_url" {
  description = "The *.run.app URL."
  value       = google_cloud_run_v2_service.app.uri
}

output "image" {
  description = "Image name Cloud Build pushes and deploys."
  value       = local.image
}

output "web_service_account" {
  value = google_service_account.web.email
}

output "build_service_account" {
  value = google_service_account.build.email
}

output "sql_connection_name" {
  description = "Cloud SQL instance connection name, for `gcloud sql connect` or the auth proxy."
  value       = google_sql_database_instance.db.connection_name
}

output "site_url" {
  description = "Public URL behind the load balancer, or the *.run.app URL when no domain is set."
  value       = var.domain == "" ? google_cloud_run_v2_service.app.uri : "https://${var.domain}"
}

output "lb_ip" {
  description = "Static IP of the load balancer; the zone's A records point here."
  value       = var.domain == "" ? null : google_compute_global_address.lb[0].address
}

output "name_servers" {
  description = "Nameservers to set at the registrar (Namecheap, Custom DNS) so the domain resolves from the Cloud DNS zone."
  value       = var.domain == "" ? [] : google_dns_managed_zone.site[0].name_servers
}
