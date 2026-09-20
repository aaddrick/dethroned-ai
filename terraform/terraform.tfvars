project_id     = "dethroned-ai"
project_number = "502665685866"
region         = "us-east4"
environment    = "prod"

# Creates the load balancer, certificate and Cloud DNS zone. Delegate the domain
# at Namecheap to `terraform output name_servers` after the first apply.
domain = "dethroned.ai"

# Only the load balancer reaches the service; the *.run.app URL returns 404.
restrict_ingress = true

# Set after linking the GitHub repo (terraform/README.md, "Cloud Build trigger").
github_repository = "projects/dethroned-ai/locations/us-east4/connections/github-aaddrick/repositories/aaddrick-dethroned-ai"

# The trigger builds and deploys pushes to this branch; main is for work.
deploy_branch = "^deploy-prod$"
