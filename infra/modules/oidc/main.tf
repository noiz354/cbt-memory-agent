# GitHub OIDC Federation — GitHub Actions tanpa static AWS keys
#
# Trust policy dibatasi hanya ke repo `noiz354/cbt-memory-agent` pada ref
# `refs/heads/main` (StringLike), sehingga role hanya bisa diasumsikan dari
# workflow repo tersebut, bukan dari repo/ref lain.
#
# Catatan: klaim `sub` GitHub kini menyertakan ID numerik owner/repo
# (contoh: `repo:noiz354@837457/cbt-memory-agent@1336016823:ref:refs/heads/main`),
# jadi pola wajib memakai wildcard `*` di sekitar owner/repo (StringLike).
#
# Catatan: provider OIDC + role dibuat oleh plan ini sendiri. Apply pertama
# harus dijalankan dengan kredensial lokal (sudah AdministratorAccess);
# setelah itu CI bisa menjalankan terraform apply dengan role ini.

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name = "cbt-github-actions-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_owner}*/${var.github_repo}*:ref:refs/heads/main"
          }
        }
      }
    ]
  })

  tags = {
    Name = "cbt-github-actions-deploy"
  }
}

# Least-privilege: hanya aksi yang dibutuhkan terraform apply + deploy frontend.
resource "aws_iam_role_policy" "github_actions" {
  name = "cbt-github-actions-deploy-scoped"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TerraformStateS3"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:ListBucketVersions",
          "s3:GetBucketVersioning",
          "s3:GetBucketLocation",
          "s3:GetBucketPolicy",
          "s3:GetBucketPolicyStatus",
          "s3:GetBucketAcl",
          "s3:GetBucketCors",
          "s3:GetBucketWebsite",
          "s3:GetBucketLogging",
          "s3:GetBucketNotification",
          "s3:GetBucketRequestPayment",
          "s3:GetBucketTagging",
          "s3:GetBucketOwnershipControls",
          "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketEncryption",
          "s3:GetEncryptionConfiguration",
          "s3:GetBucketObjectLockConfiguration",
          "s3:GetBucketAccelerateConfiguration",
          "s3:GetBucketReplication",
          "s3:GetReplicationConfiguration",
          "s3:GetBucketLifecycleConfiguration",
          "s3:GetLifecycleConfiguration",
          "s3:GetBucketIntelligentTieringConfiguration",
          "s3:GetBucketInventoryConfiguration",
          "s3:GetBucketMetricsConfiguration",
          "s3:GetBucketAnalyticsConfiguration"
        ]
        Resource = [
          "arn:aws:s3:::cbt-memory-agent-terraform-state-apse3",
          "arn:aws:s3:::cbt-memory-agent-terraform-state-apse3/*"
        ]
      },
      {
        Sid    = "TerraformStateDynamoDB"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
          "dynamodb:DescribeContinuousBackups",
          "dynamodb:DescribeTimeToLive",
          "dynamodb:ListTagsOfResource"
        ]
        Resource = ["arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/cbt-memory-agent-terraform-lock-apse3"]
      },
      {
        Sid    = "SSMParameters"
        Effect = "Allow"
        Action = [
          "ssm:PutParameter",
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParameterHistory",
          "ssm:DeleteParameter",
          "ssm:AddTagsToResource",
          "ssm:ListTagsForResource"
        ]
        Resource = ["arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter/${var.environment}/*"]
      },
      {
        Sid    = "SSMDescribe"
        Effect = "Allow"
        Action = [
          "ssm:DescribeParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = ["*"]
      },
      {
        Sid    = "LambdaFunction"
        Effect = "Allow"
        Action = [
          "lambda:CreateFunction",
          "lambda:UpdateFunctionCode",
          "lambda:UpdateFunctionConfiguration",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:GetPolicy",
          "lambda:ListTags",
          "lambda:ListVersionsByFunction",
          "lambda:PublishVersion",
          "lambda:AddPermission",
          "lambda:RemovePermission",
          "lambda:DeleteFunction",
          "lambda:GetFunctionUrlConfig",
          "lambda:CreateFunctionUrlConfig",
          "lambda:UpdateFunctionUrlConfig",
          "lambda:DeleteFunctionUrlConfig",
          "lambda:TagResource",
          "lambda:UntagResource"
        ]
        Resource = [
          "arn:aws:lambda:${var.aws_region}:${var.aws_account_id}:function:${var.function_name}",
          "arn:aws:lambda:${var.aws_region}:${var.aws_account_id}:function:${var.function_name}:*"
        ]
      },
      {
        Sid    = "LambdaLogGroup"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:DescribeLogGroups",
          "logs:PutRetentionPolicy",
          "logs:DeleteLogGroup",
          "logs:ListTagsForResource",
          "logs:GetLogEvents"
        ]
        Resource = ["arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/${var.function_name}*"]
      },
      {
        Sid    = "LogsDescribe"
        Effect = "Allow"
        Action = [
          "logs:DescribeLogGroups"
        ]
        Resource = ["*"]
      },
      {
        Sid    = "S3Buckets"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:PutBucketOwnershipControls",
          "s3:PutBucketPublicAccessBlock",
          "s3:GetBucketPolicy",
          "s3:PutBucketPolicy",
          "s3:DeleteBucketPolicy",
          "s3:GetBucketAcl",
          "s3:GetBucketCors",
          "s3:PutBucketCors",
          "s3:DeleteBucketCors",
          "s3:GetBucketWebsite",
          "s3:GetBucketLogging",
          "s3:GetBucketNotification",
          "s3:GetBucketRequestPayment",
          "s3:GetBucketPolicyStatus",
          "s3:GetBucketTagging",
          "s3:GetBucketOwnershipControls",
          "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketObjectLockConfiguration",
          "s3:GetBucketAccelerateConfiguration",
          "s3:GetBucketReplication",
          "s3:GetReplicationConfiguration",
          "s3:GetBucketLifecycleConfiguration",
          "s3:GetLifecycleConfiguration",
          "s3:GetBucketIntelligentTieringConfiguration",
          "s3:GetBucketInventoryConfiguration",
          "s3:GetBucketMetricsConfiguration",
          "s3:GetBucketAnalyticsConfiguration",
          "s3:ListBucketVersions",
          "s3:PutBucketVersioning",
          "s3:GetBucketVersioning",
          "s3:PutBucketEncryption",
          "s3:GetBucketEncryption",
          "s3:GetEncryptionConfiguration",
          "s3:GetObjectTagging",
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:DeleteObjects",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${var.s3_bucket}",
          "arn:aws:s3:::${var.s3_bucket}/*",
          "arn:aws:s3:::${var.frontend_bucket}",
          "arn:aws:s3:::${var.frontend_bucket}/*"
        ]
      },
      {
        Sid    = "CloudFront"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateDistribution",
          "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution",
          "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig",
          "cloudfront:ListDistributions",
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
          "cloudfront:CreateOriginAccessControl",
          "cloudfront:UpdateOriginAccessControl",
          "cloudfront:DeleteOriginAccessControl",
          "cloudfront:GetOriginAccessControl",
          "cloudfront:ListOriginAccessControls",
          "cloudfront:ListTagsForResource",
          "cloudfront:CreateCachePolicy",
          "cloudfront:UpdateCachePolicy",
          "cloudfront:DeleteCachePolicy",
          "cloudfront:GetCachePolicy",
          "cloudfront:ListCachePolicies",
          "cloudfront:CreateResponseHeadersPolicy",
          "cloudfront:UpdateResponseHeadersPolicy",
          "cloudfront:DeleteResponseHeadersPolicy",
          "cloudfront:GetResponseHeadersPolicy",
          "cloudfront:ListResponseHeadersPolicies",
          "cloudfront:TagResource",
          "cloudfront:UntagResource"
        ]
        Resource = ["*"] # aksi CloudFront tidak berbasis resource-ARN
      },
      {
        Sid    = "IAMRoleCrd"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:GetRole",
          "iam:DeleteRole",
          "iam:PutRolePolicy",
          "iam:GetRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListPolicyVersions",
          "iam:TagRole"
        ]
        Resource = [
          "arn:aws:iam::${var.aws_account_id}:role/${var.function_name}-execution",
          "arn:aws:iam::${var.aws_account_id}:role/cbt-github-actions-deploy"
        ]
      },
      {
        Sid      = "IAMPassRole"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = ["arn:aws:iam::${var.aws_account_id}:role/${var.function_name}-execution"]
      },
      {
        Sid    = "IAMOIDCProvider"
        Effect = "Allow"
        Action = [
          "iam:CreateOpenIDConnectProvider",
          "iam:GetOpenIDConnectProvider",
          "iam:UpdateOpenIDConnectProviderThumbprint",
          "iam:DeleteOpenIDConnectProvider",
          "iam:ListOpenIDConnectProviders",
          "iam:AddClientIDToOpenIDConnectProvider",
          "iam:RemoveClientIDFromOpenIDConnectProvider"
        ]
        Resource = ["*"] # operasi OIDC provider tidak berbasis resource-ARN
      },
      {
        Sid    = "EventBridge"
        Effect = "Allow"
        Action = [
          "events:PutRule",
          "events:DescribeRule",
          "events:DeleteRule",
          "events:PutTargets",
          "events:RemoveTargets",
          "events:ListTargetsByRule",
          "events:ListTagsForResource",
          "events:TagResource",
          "events:UntagResource"
        ]
        Resource = ["arn:aws:events:${var.aws_region}:${var.aws_account_id}:rule/${var.function_name}-reflect"]
      },
      {
        Sid    = "CloudWatch"
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData",
          "cloudwatch:GetMetricData",
          "cloudwatch:DescribeAlarms",
          "cloudwatch:ListMetrics",
          "cloudwatch:ListTagsForResource"
        ]
        Resource = ["*"]
      }
    ]
  })
}
