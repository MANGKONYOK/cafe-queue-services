#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Omkoi Station (cafe-queue-services) - Idempotent Google Cloud Run Deployment
# ==============================================================================
# Usage:
#   ./deploy/deploy.sh [--demo]
#
# Environment Variables (Optional):
#   PROJECT_ID   GCP Project ID (defaults to active gcloud config project)
#   REGION       GCP Region (default: asia-southeast1)
#   DRY_RUN      Set DRY_RUN=1 to print gcloud commands without executing
# ==============================================================================

DRY_RUN="${DRY_RUN:-0}"
REGION="${REGION:-asia-southeast1}"

for arg in "$@"; do
  case "$arg" in
    --demo) ;; # Omkoi seeds all 5 role accounts via Secret Manager on every deploy
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--demo]" >&2
      exit 1
      ;;
  esac
done

# Logs command while redacting any --password=... value.
run_cmd() {
  local arg
  if [ "$DRY_RUN" = "1" ]; then
    printf '[DRY_RUN] '
  else
    printf '+ '
  fi
  for arg in "$@"; do
    case "$arg" in
      --password=*) printf '%s ' '--password=<REDACTED>' ;;
      *) printf '%q ' "$arg" ;;
    esac
  done
  printf '\n'
  if [ "$DRY_RUN" != "1" ]; then
    "$@"
  fi
}

if [ "$DRY_RUN" = "1" ]; then
  PROJECT_ID="${PROJECT_ID:-example-gcp-project}"
else
  PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
  if [ -z "$PROJECT_ID" ]; then
    echo "Error: PROJECT_ID is not set and no active gcloud project was found." >&2
    echo "Run: gcloud config set project YOUR_PROJECT_ID" >&2
    exit 1
  fi
fi

# ------------------------------------------------------------------------------
# Omkoi Station Resource Names (must match deploy/release.sh, teardown.sh, deploy.yml)
# ------------------------------------------------------------------------------
REPO_NAME="omkoi-queue"
SQL_INSTANCE="omkoi-queue-db"
DB_NAME="omkoi_queue"
DB_USER="omkoi_user"
SERVICE_NAME="omkoi-queue"
MIGRATE_JOB_NAME="omkoi-queue-migrate"
SA_NAME="omkoi-queue-runner"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SQL_CONN_NAME="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"

# Secret Manager names (values never committed or printed).
SECRET_DB_URL="omkoi-database-url"
SECRET_SESSION="omkoi-session-secret"
SECRET_ADMIN_PASS="omkoi-admin-password"
SECRET_STAFF_PASS="omkoi-staff-password"
SECRET_CUSTOMER_PASS="omkoi-customer-password"

echo "=================================================================="
echo "Omkoi Station Cloud Run Deployment"
echo "Project : ${PROJECT_ID}"
echo "Region  : ${REGION}"
echo "Dry Run : ${DRY_RUN}"
echo "=================================================================="

# 1. Enable required GCP APIs
run_cmd gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  --project "$PROJECT_ID"

# 2. Create Artifact Registry Docker repository (idempotent)
if [ "$DRY_RUN" = "1" ]; then
  run_cmd gcloud artifacts repositories describe "$REPO_NAME" --location "$REGION" --project "$PROJECT_ID"
  run_cmd gcloud artifacts repositories create "$REPO_NAME" --repository-format=docker --location "$REGION" --description="Omkoi Station container repository" --project "$PROJECT_ID"
else
  if ! gcloud artifacts repositories describe "$REPO_NAME" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    run_cmd gcloud artifacts repositories create "$REPO_NAME" \
      --repository-format=docker \
      --location "$REGION" \
      --description="Omkoi Station container repository" \
      --project "$PROJECT_ID"
  fi
fi

# 3. Create Cloud SQL for PostgreSQL 16 instance (idempotent, --edition=enterprise required for db-f1-micro)
if [ "$DRY_RUN" = "1" ]; then
  run_cmd gcloud sql instances describe "$SQL_INSTANCE" --project "$PROJECT_ID"
  run_cmd gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --edition=enterprise --tier=db-f1-micro --region="$REGION" --storage-size=10GB --storage-type=SSD --no-storage-auto-increase --backup-start-time=03:00 --project "$PROJECT_ID"
else
  if ! gcloud sql instances describe "$SQL_INSTANCE" --project "$PROJECT_ID" >/dev/null 2>&1; then
    run_cmd gcloud sql instances create "$SQL_INSTANCE" \
      --database-version=POSTGRES_16 \
      --edition=enterprise \
      --tier=db-f1-micro \
      --region="$REGION" \
      --storage-size=10GB \
      --storage-type=SSD \
      --no-storage-auto-increase \
      --backup-start-time=03:00 \
      --project "$PROJECT_ID"
  fi
fi

# 4. Create application database (idempotent)
if [ "$DRY_RUN" = "1" ]; then
  run_cmd gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" --project "$PROJECT_ID"
  run_cmd gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE" --project "$PROJECT_ID"
else
  if ! gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" --project "$PROJECT_ID" >/dev/null 2>&1; then
    run_cmd gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE" --project "$PROJECT_ID"
  fi
fi

# 5. Create runtime Service Account & Cloud SQL Client binding (idempotent)
if [ "$DRY_RUN" = "1" ]; then
  run_cmd gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID"
  run_cmd gcloud iam service-accounts create "$SA_NAME" --display-name="Omkoi Station Cloud Run Service Account" --project "$PROJECT_ID"
else
  if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
    run_cmd gcloud iam service-accounts create "$SA_NAME" \
      --display-name="Omkoi Station Cloud Run Service Account" \
      --project "$PROJECT_ID"
  fi
fi

run_cmd gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client" \
  --condition=None \
  --format=none --quiet

# 6. Create/sync DB user & DATABASE_URL secret in Secret Manager (only if missing)
if [ "$DRY_RUN" = "1" ]; then
  run_cmd gcloud secrets describe "$SECRET_DB_URL" --project "$PROJECT_ID"
  run_cmd gcloud sql users list --instance="$SQL_INSTANCE" --project "$PROJECT_ID" --format="value(name)"
  run_cmd gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="<GENERATED_HEX_PASSWORD>" --project "$PROJECT_ID"
  run_cmd gcloud secrets create "$SECRET_DB_URL" --replication-policy="automatic" --project "$PROJECT_ID"
  run_cmd gcloud secrets versions add "$SECRET_DB_URL" --data-file=- --project "$PROJECT_ID"
else
  if ! gcloud secrets describe "$SECRET_DB_URL" --project "$PROJECT_ID" >/dev/null 2>&1; then
    DB_PASS="$(openssl rand -hex 24)"
    if gcloud sql users list --instance="$SQL_INSTANCE" --project "$PROJECT_ID" --format="value(name)" | grep -qx "$DB_USER"; then
      run_cmd gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASS" --project "$PROJECT_ID"
    else
      run_cmd gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASS" --project "$PROJECT_ID"
    fi
    DB_URL_VALUE="postgresql://${DB_USER}:${DB_PASS}@localhost/${DB_NAME}?host=/cloudsql/${SQL_CONN_NAME}"
    run_cmd gcloud secrets create "$SECRET_DB_URL" --replication-policy="automatic" --project "$PROJECT_ID"
    printf "%s" "$DB_URL_VALUE" | gcloud secrets versions add "$SECRET_DB_URL" --data-file=- --project "$PROJECT_ID"
  fi
fi

# 7. Create SESSION_SECRET and seeded role passwords idempotently in Secret Manager
create_generated_secret() {
  local secret_name="$1"
  local secret_kind="$2"
  local value=""
  if [ "$DRY_RUN" = "1" ]; then
    run_cmd gcloud secrets describe "$secret_name" --project "$PROJECT_ID"
    run_cmd gcloud secrets create "$secret_name" --replication-policy="automatic" --project "$PROJECT_ID"
    run_cmd gcloud secrets versions add "$secret_name" --data-file=- --project "$PROJECT_ID"
    return
  fi
  if ! gcloud secrets describe "$secret_name" --project "$PROJECT_ID" >/dev/null 2>&1; then
    if [ "$secret_kind" = "hex32" ]; then
      value="$(openssl rand -hex 32)"
    else
      value="$(openssl rand -base64 16 | tr -d '/+=' | cut -c1-14)Aa1!"
    fi
    run_cmd gcloud secrets create "$secret_name" --replication-policy="automatic" --project "$PROJECT_ID"
    printf "%s" "$value" | gcloud secrets versions add "$secret_name" --data-file=- --project "$PROJECT_ID"
  fi
}

create_generated_secret "$SECRET_SESSION" "hex32"
create_generated_secret "$SECRET_ADMIN_PASS" "password"
create_generated_secret "$SECRET_STAFF_PASS" "password"
create_generated_secret "$SECRET_CUSTOMER_PASS" "password"

# 8. Grant least-privilege per-secret access ONLY (never project-wide secretAccessor)
RUNTIME_SECRETS=("$SECRET_DB_URL" "$SECRET_SESSION" "$SECRET_ADMIN_PASS" "$SECRET_STAFF_PASS" "$SECRET_CUSTOMER_PASS")
for secret in "${RUNTIME_SECRETS[@]}"; do
  run_cmd gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    --project "$PROJECT_ID" --format=none --quiet
done

# 9. Build & push container image via Cloud Build
run_cmd gcloud builds submit \
  --tag "$IMAGE_URI" \
  --project "$PROJECT_ID"

# 10. Create/update & execute Cloud Run Job for SQL migration + idempotent seed
JOB_SECRETS="DATABASE_URL=${SECRET_DB_URL}:latest,SEED_ADMIN_PASSWORD=${SECRET_ADMIN_PASS}:latest,SEED_STAFF_PASSWORD=${SECRET_STAFF_PASS}:latest,SEED_CUSTOMER_PASSWORD=${SECRET_CUSTOMER_PASS}:latest"
run_cmd gcloud run jobs deploy "$MIGRATE_JOB_NAME" \
  --image "$IMAGE_URI" \
  --region "$REGION" \
  --service-account "$SA_EMAIL" \
  --set-cloudsql-instances "$SQL_CONN_NAME" \
  --set-secrets "$JOB_SECRETS" \
  --set-env-vars "NODE_ENV=production,TZ=Asia/Bangkok" \
  --command "sh" \
  --args "-c,npm run db:migrate && npm run db:seed:prod" \
  --max-retries 1 \
  --task-timeout 300s \
  --project "$PROJECT_ID"

if ! run_cmd gcloud run jobs execute "$MIGRATE_JOB_NAME" \
  --region "$REGION" \
  --wait \
  --project "$PROJECT_ID"; then
  printf '%s\n' "ERROR: Cloud Run migration job '${MIGRATE_JOB_NAME}' failed. Aborting service deployment." >&2
  exit 1
fi

# 11. Deploy Cloud Run Service
APP_SECRETS="DATABASE_URL=${SECRET_DB_URL}:latest,SESSION_SECRET=${SECRET_SESSION}:latest"
run_cmd gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_URI" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --service-account "$SA_EMAIL" \
  --add-cloudsql-instances "$SQL_CONN_NAME" \
  --set-secrets "$APP_SECRETS" \
  --set-env-vars "NODE_ENV=production,TZ=Asia/Bangkok,PG_POOL_MAX=5" \
  --min-instances 0 \
  --max-instances 3 \
  --memory 512Mi \
  --cpu 1 \
  --port 3000 \
  --project "$PROJECT_ID"

if [ "$DRY_RUN" = "1" ]; then
  SERVICE_URL="https://${SERVICE_NAME}-<hash>-as.a.run.app"
else
  SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"
fi

printf '\n'
printf '%s\n' "=================================================================="
printf '%s\n' "Omkoi Station Cloud Run Deployment Completed!"
printf '%s\n' "Service URL      : ${SERVICE_URL}"
printf '%s\n' "Health Check     : ${SERVICE_URL}/api/health"
printf '%s\n' "Readiness Check  : ${SERVICE_URL}/api/ready"
printf '%s\n' "Admin Secret     : ${SECRET_ADMIN_PASS} (not printed)"
printf '%s\n' "Staff Secret     : ${SECRET_STAFF_PASS} (not printed)"
printf '%s\n' "Customer Secret  : ${SECRET_CUSTOMER_PASS} (not printed)"
printf '%s\n' "=================================================================="
