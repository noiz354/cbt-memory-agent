# Provider Configuration
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Remote state (S3 + lockfile)
  backend "s3" {
    bucket       = "cbt-memory-agent-terraform-state-apse3"
    key          = "hackathon/terraform.tfstate"
    region       = "ap-southeast-3"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "cbt-memory-agent"
      Env       = var.environment
      ManagedBy = "terraform"
      Deadline  = "2026-08-18"
      Hackathon = "CockroachDB x AWS"
    }
  }
}
