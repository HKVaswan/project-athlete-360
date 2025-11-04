/*
  infra/terraform/postgres_backups.tf
  -----------------------------------
  Enterprise-grade Terraform configuration to:

    - Provision a dedicated S3 bucket for encrypted backups & exported snapshots
    - Create a KMS key for server-side encryption (rotate-able)
    - Create an IAM role + policy to allow RDS to export snapshots to S3
    - (Optional) Create AWS Backup Vault + Plan to orchestrate scheduled backups & retention
    - Provide outputs for integration with runbooks / backup clients

  Notes:
    - This file assumes you already have an RDS instance (or cluster). Provide its ARN/identifier
      via variable `rds_resource_arn` (for snapshot exports or backup selections).
    - For PITR (Point-In-Time Recovery) rely on RDS automated backups + WAL (automatic when backups enabled).
      You must ensure the DB has adequate `backup_retention_days` and parameter group config (wal_level).
      Parameter group management for wal_level can be done separately via `aws_db_parameter_group`.
    - Secrets (DB credentials, etc.) should be stored in Secrets Manager or external vault — do NOT hardcode.
*/

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  required_version = ">= 1.2.0"
}

provider "aws" {
  region = var.region
}

/* -----------------------------
   Variables
   ----------------------------- */
variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Project prefix used for naming resources"
  type        = string
  default     = "pa360"
}

variable "environment" {
  description = "Environment (dev/staging/prod)"
  type        = string
  default     = "prod"
}

variable "rds_resource_arn" {
  description = "ARN of RDS instance or cluster to include in backup/reconciliation (e.g. arn:aws:rds:...:db:mydb)"
  type        = string
  default     = ""
}

variable "backup_retention_days" {
  description = "How many days to keep automated backups / retention for AWS Backup"
  type        = number
  default     = 30
}

variable "snapshot_export_bucket_name" {
  description = "Optional: provide bucket name, otherwise Terraform generates one"
  type        = string
  default     = ""
}

variable "enable_aws_backup" {
  description = "Whether to create AWS Backup resources (vault + plan) to schedule backups"
  type        = bool
  default     = true
}

/* -----------------------------
   Naming helpers
   ----------------------------- */
locals {
  name_prefix   = "${var.project}-${var.environment}"
  s3_bucket     = var.snapshot_export_bucket_name != "" ? var.snapshot_export_bucket_name : "${local.name_prefix}-pg-backups"
  kms_alias     = "alias/${local.name_prefix}-backup-kms"
  snapshot_role = "${local.name_prefix}-rds-snapshot-export-role"
  backup_vault  = "${local.name_prefix}-backup-vault"
  backup_plan   = "${local.name_prefix}-backup-plan"
}

/* -----------------------------
   S3 Bucket for Backups / Exports
   - Encrypted with KMS
   - Block public access
   - Lifecycle rules for retention + transition
   ----------------------------- */
resource "aws_s3_bucket" "backups" {
  bucket = local.s3_bucket

  acl = "private"

  server_side_encryption_configuration {
    rule {
      apply_server_side_encryption_by_default {
        kms_master_key_id = aws_kms_key.backup_key.arn
        sse_algorithm     = "aws:kms"
      }
    }
  }

  versioning {
    enabled = true
  }

  lifecycle_rule {
    id      = "expire-old-backups"
    enabled = true

    expiration {
      days = var.backup_retention_days
    }

    noncurrent_version_expiration {
      days = var.backup_retention_days + 7
    }

    abort_incomplete_multipart_upload_days = 7
  }

  tags = {
    Name        = local.s3_bucket
    Project     = var.project
    Environment = var.environment
  }
}

/* block public access */
resource "aws_s3_bucket_public_access_block" "backups_block" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

/* -----------------------------
   KMS key for bucket encryption (rotation enabled)
   ----------------------------- */
resource "aws_kms_key" "backup_key" {
  description             = "KMS key for ${local.name_prefix} backups and snapshot export encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "${local.name_prefix}-backup-key"
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_kms_alias" "backup_key_alias" {
  name          = local.kms_alias
  target_key_id = aws_kms_key.backup_key.key_id
}

/* -----------------------------
   IAM Role & Policy for RDS Snapshot Export → S3
   - RDS needs an IAM role that allows it to write exported snapshots to S3
   - Trust policy allows rds.amazonaws.com to assume the role
   ----------------------------- */
data "aws_iam_policy_document" "rds_snapshot_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rds_snapshot_export_role" {
  name               = local.snapshot_role
  assume_role_policy = data.aws_iam_policy_document.rds_snapshot_trust.json

  tags = {
    Name        = local.snapshot_role
    Project     = var.project
    Environment = var.environment
  }
}

/* Minimal policy for RDS to export DB snapshots to the bucket using KMS */
data "aws_iam_policy_document" "rds_snapshot_policy" {
  statement {
    sid    = "S3Write"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:PutObjectAcl",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
      "s3:ListBucket",
      "s3:GetBucketLocation"
    ]
    resources = [
      aws_s3_bucket.backups.arn,
      "${aws_s3_bucket.backups.arn}/*"
    ]
  }

  statement {
    sid    = "KMSUse"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey",
      "kms:ReEncrypt*"
    ]
    resources = [aws_kms_key.backup_key.arn]
  }
}

resource "aws_iam_role_policy" "rds_snapshot_policy_attachment" {
  name   = "${local.snapshot_role}-policy"
  role   = aws_iam_role.rds_snapshot_export_role.id
  policy = data.aws_iam_policy_document.rds_snapshot_policy.json
}

/* -----------------------------
   AWS Backup (Optional)
   - Vault + Plan + Selection (selecting RDS resource if provided)
   ----------------------------- */
resource "aws_backup_vault" "vault" {
  count = var.enable_aws_backup ? 1 : 0

  name        = local.backup_vault
  kms_key_arn = aws_kms_key.backup_key.arn

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_backup_plan" "plan" {
  count = var.enable_aws_backup ? 1 : 0

  name = local.backup_plan

  rule {
    rule_name         = "${local.backup_plan}-daily"
    target_vault_name = aws_backup_vault.vault[0].name
    schedule          = "cron(0 3 ? * * *)" # daily at 03:00 UTC
    lifecycle {
      delete_after = var.backup_retention_days
    }
    completion_window = 120
    start_window      = 60
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

/* If RDS ARN provided and backup plan enabled, attach selection */
resource "aws_backup_selection" "rds_selection" {
  count = var.enable_aws_backup && length(trimspace(var.rds_resource_arn)) > 0 ? 1 : 0

  iam_role_arn = aws_iam_role.rds_snapshot_export_role.arn
  name         = "${local.backup_plan}-selection"
  plan_id      = aws_backup_plan.plan[0].id

  resources = [
    var.rds_resource_arn
  ]
}

/* -----------------------------
   Outputs
   ----------------------------- */
output "backups_s3_bucket" {
  description = "S3 bucket name used to store backups / exported snapshots"
  value       = aws_s3_bucket.backups.bucket
}

output "backups_s3_bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.backups.arn
}

output "kms_key_arn" {
  description = "KMS key ARN used to encrypt backups"
  value       = aws_kms_key.backup_key.arn
}

output "rds_snapshot_export_role_arn" {
  description = "IAM role ARN that RDS can assume to export snapshots to S3"
  value       = aws_iam_role.rds_snapshot_export_role.arn
}

output "aws_backup_vault_arn" {
  description = "AWS Backup vault ARN (if enabled)"
  value       = var.enable_aws_backup ? aws_backup_vault.vault[0].arn : ""
}

output "aws_backup_plan_id" {
  description = "AWS Backup plan id (if enabled)"
  value       = var.enable_aws_backup ? aws_backup_plan.plan[0].id : ""
}