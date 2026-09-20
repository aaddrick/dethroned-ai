variable "project_id" {
  description = "GCP project ID."
  type        = string

  validation {
    condition     = length(var.project_id) > 0
    error_message = "project_id must not be empty."
  }
}

variable "project_number" {
  description = "GCP project number (needed for service-agent identities)."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Artifact Registry, Cloud Build and the log bucket."
  type        = string
  default     = "us-east4"

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]+$", var.region))
    error_message = "region must be a valid GCP region (e.g. us-east4)."
  }
}

variable "environment" {
  description = "Deployment environment label. Dethrone has one environment; the value is only used in labels."
  type        = string
  default     = "prod"
}

variable "service_name" {
  description = "Cloud Run service name. Also the Artifact Registry image name."
  type        = string
  default     = "dethrone"
}

variable "domain" {
  description = <<-EOT
    Apex domain served by the load balancer (e.g. dethroned.ai). Creates the
    balancer, the managed certificate for the apex and www, and the Cloud DNS zone
    (load_balancer.tf, dns.tf). Leave empty to serve from the *.run.app URL only.
    After apply, delegate the domain at the registrar to `terraform output
    name_servers`.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.domain == "" || can(regex("^[a-z0-9-]+(\\.[a-z0-9-]+)+$", var.domain))
    error_message = "domain must be a bare apex name such as dethroned.ai, or empty."
  }
}

variable "restrict_ingress" {
  description = <<-EOT
    Close the *.run.app URL so traffic only arrives through the load balancer,
    as nonconvexlabs.com and aaddrick.com do. Turn on only after
    https://<domain> works: the certificate needs the registrar delegation and
    up to an hour to issue, and the service is unreachable from outside in the
    meantime. Ignored when domain is empty.
  EOT
  type        = bool
  default     = false
}

variable "github_repository" {
  description = <<-EOT
    Full resource name of the Cloud Build 2nd-gen linked repository, e.g.
    projects/dethroned-ai/locations/us-east4/connections/github-aaddrick/repositories/aaddrick-dethroned-ai.
    Empty disables the Cloud Build trigger. The GitHub connection itself needs an
    interactive app install and is not managed here; see terraform/README.md.
  EOT
  type        = string
  default     = ""
}

variable "deploy_branch" {
  description = "Branch regex that fires the Cloud Build trigger."
  type        = string
  default     = "^main$"
}

variable "jev_model" {
  description = "Model name sent to the Jev API."
  type        = string
  default     = "jev-latest"
}

variable "max_instances" {
  description = "Cloud Run max instances. The app's per-IP limit is per instance, so keep this small."
  type        = number
  default     = 3
}

variable "container_concurrency" {
  description = "Concurrent requests per instance. Node handles many; the real ceiling is Jev's 1,200 requests/minute."
  type        = number
  default     = 80
}

variable "per_ip_per_min" {
  description = "Turns per minute one IP may play (PER_IP_PER_MIN in server.js)."
  type        = number
  default     = 120
}

variable "daily_turn_cap" {
  description = "Turns the whole service will play in one UTC day (DAILY_TURN_CAP in server.js)."
  type        = number
  default     = 20000
}

variable "max_in_flight" {
  description = "Turns one instance will process at once (MAX_IN_FLIGHT in server.js)."
  type        = number
  default     = 12
}

variable "sql_tier" {
  description = "Cloud SQL machine tier. db-f1-micro (shared core, no SLA) is about $8 a month."
  type        = string
  default     = "db-f1-micro"
}
