# terraform/dns.tf
# Cloud DNS zone for the domain, as for nonconvexlabs.com and aaddrick.com:
# Namecheap keeps the registration and delegates to the four nameservers in
# `terraform output name_servers`. Only the apex and www exist; the domain has
# no mail, so the registrar's forwarding MX records are dropped on purpose.
#
# Gated on var.domain like the balancer. About $0.20 a month.

resource "google_dns_managed_zone" "site" {
  count       = local.lb_count
  name        = "${var.service_name}-zone"
  project     = var.project_id
  dns_name    = "${var.domain}."
  description = "${var.domain}, served by the ${var.service_name} load balancer"
  visibility  = "public"

  depends_on = [google_project_service.apis["dns.googleapis.com"]]
}

resource "google_dns_record_set" "apex" {
  count        = local.lb_count
  name         = google_dns_managed_zone.site[0].dns_name
  project      = var.project_id
  managed_zone = google_dns_managed_zone.site[0].name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb[0].address]
}

resource "google_dns_record_set" "www" {
  count        = local.lb_count
  name         = "www.${google_dns_managed_zone.site[0].dns_name}"
  project      = var.project_id
  managed_zone = google_dns_managed_zone.site[0].name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb[0].address]
}
