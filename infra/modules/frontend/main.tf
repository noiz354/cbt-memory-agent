# Frontend Module — S3 + CloudFront untuk SPA (Vite build)
#
# - Bucket privat; akses publik TIDAK dibuka (hanya lewat CloudFront OAC).
# - Default behavior: SPA dari S3 (cache policy honor Cache-Control origin).
# - Behavior /api/v1/*: proxy ke Lambda Function URL (CachingDisabled).
# - Response Headers Policy mereplikasi header keamanan nginx (CSP, nosniff,
#   frame-deny, referrer).

# ── S3 bucket (origin) ──────────────────────────────────────────────────────
resource "aws_s3_bucket" "frontend" {
  bucket        = var.bucket_name
  force_destroy = true

  tags = {
    Name = "CBT Memory Agent Frontend"
  }
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ── Origin Access Control (S3 hanya bisa dibaca via CloudFront) ─────────────
resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${var.bucket_name}-oac"
  description                       = "Restrict S3 access to CloudFront"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "frontend_bucket_policy" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket_policy.json
}

# ── Cache policy (SPA): min 0, honor origin Cache-Control max-age ───────────
resource "aws_cloudfront_cache_policy" "spa" {
  name        = "${var.bucket_name}-spa"
  comment     = "SPA default: min 0, honor origin Cache-Control max-age"
  default_ttl = 0
  min_ttl     = 0
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# ── Response Headers Policy (replikasi nginx.conf) ──────────────────────────
resource "aws_cloudfront_response_headers_policy" "spa" {
  name    = "${var.bucket_name}-security-headers"
  comment = "Replicate nginx security headers (CSP, nosniff, frame-deny, referrer)"

  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' blob: https://cbt-memory-exports.s3.ap-southeast-3.amazonaws.com; font-src 'self'; base-uri 'self'; form-action 'self';"
      override                = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }
  }
}

# ── CloudFront distribution ─────────────────────────────────────────────────
resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200" # US/EU + Asia Pacific (target: ID)
  comment             = "CBT Memory Agent frontend (SPA + /api/v1 proxy)"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    domain_name = var.api_origin_domain
    origin_id   = "api-lambda"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = aws_cloudfront_cache_policy.spa.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.spa.id
  }

  ordered_cache_behavior {
    path_pattern           = "/api/v1/*"
    target_origin_id       = "api-lambda"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "POST", "DELETE", "PUT", "PATCH"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # Managed-CachingDisabled (4135ea2d-6df8-44a3-9df3-4b5a84be39ad) +
    # Managed-AllViewerExceptHostHeader (b689b0a8-53d0-40ab-baf2-68738e2966ac):
    # forward semua header viewer (Authorization + query string), Host diganti origin.
    cache_policy_id            = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id   = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.spa.id
  }

  # SPA fallback: route tak dikenal → index.html (tanpa Lambda@Edge)
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
      locations        = []
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
