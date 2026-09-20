# terraform/load_balancer.tf
# Global external Application Load Balancer in front of the Cloud Run service,
# the same shape as nonconvexlabs.com and aaddrick.com in ncl-prod: one static
# IP, a Google-managed certificate for the apex and www, a serverless NEG on the
# service, an HTTPS URL map that sends www to the apex, and an HTTP listener that
# only redirects to HTTPS. No Cloud Armor: the app rate-limits per IP itself and
# a WAF policy would cost more than the rest of the balancer.
#
# Everything here is gated on var.domain. With it empty the service is reachable
# on its *.run.app URL only and nothing below exists.
#
# Cost: the two forwarding rules are about $18 a month; the rest is free at demo
# traffic.

locals {
  lb_count = var.domain == "" ? 0 : 1
}

# ─── address ─────────────────────────────────────────────────────────────────

resource "google_compute_global_address" "lb" {
  count        = local.lb_count
  name         = "${var.service_name}-ip"
  project      = var.project_id
  ip_version   = "IPV4"
  address_type = "EXTERNAL"

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

# ─── certificate ─────────────────────────────────────────────────────────────

# Google issues this once both names resolve to the address above and the HTTPS
# forwarding rule is up. Until then its status is PROVISIONING and the balancer
# answers TLS with a placeholder; check with
#   gcloud compute ssl-certificates describe dethrone-cert --global
resource "google_compute_managed_ssl_certificate" "lb" {
  count   = local.lb_count
  name    = "${var.service_name}-cert"
  project = var.project_id

  managed {
    domains = [var.domain, "www.${var.domain}"]
  }

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

# ─── backend ─────────────────────────────────────────────────────────────────

resource "google_compute_region_network_endpoint_group" "lb" {
  count                 = local.lb_count
  name                  = "${var.service_name}-neg"
  project               = var.project_id
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.app.name
  }

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

# Request logging at 100%: the balancer log is the only place a request is
# recorded once ingress is restricted, and it is cheap at demo traffic.
resource "google_compute_backend_service" "lb" {
  count                 = local.lb_count
  name                  = "${var.service_name}-backend"
  project               = var.project_id
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.lb[0].id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

# ─── routing ─────────────────────────────────────────────────────────────────

# Apex serves the app; www is a permanent redirect to the apex.
resource "google_compute_url_map" "https" {
  count           = local.lb_count
  name            = "${var.service_name}-urlmap"
  project         = var.project_id
  default_service = google_compute_backend_service.lb[0].id

  host_rule {
    hosts        = ["www.${var.domain}"]
    path_matcher = "www"
  }

  path_matcher {
    name = "www"

    default_url_redirect {
      host_redirect          = var.domain
      https_redirect         = true
      redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
      strip_query            = false
    }
  }
}

# Port 80 has no backend at all; every request is a 301 to https.
resource "google_compute_url_map" "http_redirect" {
  count   = local.lb_count
  name    = "${var.service_name}-http-redirect"
  project = var.project_id

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

# ─── proxies and listeners ───────────────────────────────────────────────────

resource "google_compute_target_https_proxy" "lb" {
  count            = local.lb_count
  name             = "${var.service_name}-https-proxy"
  project          = var.project_id
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.lb[0].id]
}

resource "google_compute_target_http_proxy" "lb" {
  count   = local.lb_count
  name    = "${var.service_name}-http-proxy"
  project = var.project_id
  url_map = google_compute_url_map.http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.lb_count
  name                  = "${var.service_name}-https-rule"
  project               = var.project_id
  target                = google_compute_target_https_proxy.lb[0].id
  ip_address            = google_compute_global_address.lb[0].address
  port_range            = "443"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = local.lb_count
  name                  = "${var.service_name}-http-rule"
  project               = var.project_id
  target                = google_compute_target_http_proxy.lb[0].id
  ip_address            = google_compute_global_address.lb[0].address
  port_range            = "80"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
