#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Omkoi Station - Google Cloud Run & Cloud SQL Script
# ==============================================================================
# Deletes resources provisioned by deploy/deploy.sh to stop GCP billing after
# final course grading is complete.
# ==============================================================================

DRY_RUN="${DRY_RUN:-0}"
REGION="${REGION:-asia-southeast1}"

run_cmd() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY_RUN] $*"
  else
    echo "+ $*"
    "$@"
  fi
}

if [ "$DRY_RUN" = "1" ]; then
  PROJECT_ID="${PROJECT_ID:-example-gcp-project}"
else
  PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
  if [ -z "$PROJECT_ID" ]; then
    echo "Error: PROJECT_ID is not set and no active gcloud project was found." >&2
    exit 1
  fi
fi

REPO_NAME="omkoi-queue"
SQL_INSTANCE="omkoi-queue-db"
SERVICE_NAME="omkoi-queue"
MIGRATE_JOB_NAME="omkoi-queue-migrate"
SA_NAME="omkoi-queue-runner"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

SECRET_DB_URL="omkoi-database-url"
SECRET_SESSION="omkoi-session-secret"
SECRET_ADMIN_PASS="omkoi-admin-password"
SECRET_STAFF_PASS="omkoi-staff-password"
SECRET_CUSTOMER_PASS="omkoi-customer-password"

echo "=================================================================="
echo "WARNING: This will permanently delete Omkoi Station GCP resources in:"
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "Resources to be deleted:"
echo "  - Cloud Run Service : ${SERVICE_NAME}"
echo "  - Cloud Run Job     : ${MIGRATE_JOB_NAME}"
echo "  - Cloud SQL Instance: ${SQL_INSTANCE} (ALL DATABASE DATA WILL BE LOST)"
echo "  - Artifact Registry : ${REPO_NAME}"
echo "  - Secrets           : ${SECRET_DB_URL}, ${SECRET_SESSION}, ${SECRET_ADMIN_PASS}, ${SECRET_STAFF_PASS}, ${SECRET_CUSTOMER_PASS}"
echo "  - Service Account   : ${SA_EMAIL}"
echo "=================================================================="

if [ "$DRY_RUN" != "1" ]; then
  read -r -p "Type the project ID (${PROJECT_ID}) to confirm deletion: " CONFIRM_PROJECT
  if [ "$CONFIRM_PROJECT" != "$PROJECT_ID" ]; then
    echo "Aborted: confirmation did not match ${PROJECT_ID}."
    exit 1
  fi
fi

run_cmd gcloud run services delete "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --quiet || true
run_cmd gcloud run jobs delete "$MIGRATE_JOB_NAME" --region "$REGION" --project "$PROJECT_ID" --quiet || true
run_cmd gcloud sql instances delete "$SQL_INSTANCE" --project "$PROJECT_ID" --quiet || true
run_cmd gcloud artifacts repositories delete "$REPO_NAME" --location "$REGION" --project "$PROJECT_ID" --quiet || true
run_cmd gcloud secrets delete "$SECRET_DB_URL" --project "$PROJECT_ID" --quiet || true
run_cmd gcloud secrets delete "$SECRET_SESSION" --project "$PROJECT_ID" --quiet || true
run_cmd gcloud secrets delete "$SECRET_ADMIN_PASS" --project "$PROJECT_ID" --quiet || true
run_cmd gcloud secrets delete "$SECRET_STAFF_PASS" --project "$PROJECT_ID" --quiet || true
run_cmd gcloud secrets delete "$SECRET_CUSTOMER_PASS" --project "$PROJECT_ID" --quiet || true
run_cmd gcloud iam service-accounts delete "$SA_EMAIL" --project "$PROJECT_ID" --quiet || true

echo "Teardown completed."
