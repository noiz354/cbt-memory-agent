# Provider Configuration
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state (S3 + DynamoDB lock)
  backend "s3" {
    bucket         = "cbt-memory-agent-terraform-state"
    key            = "hackathon/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "cbt-memory-agent-terraform-lock"
    encrypt        = true
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
