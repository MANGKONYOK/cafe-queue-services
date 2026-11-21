#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Omkoi Station - keyless GitHub Actions -> GCP sign-in (Lab 5 Issue #11, Guide Episode 6.2-6.3)
# ==============================================================================
# Creates, idempotently:
#   - the deployer service account omkoi-queue-deployer (no JSON key, ever)
#   - its least-privilege roles: run.developer (project), artifactregistry.writer
#     (repository omkoi-queue only), iam.serviceAccountUser (on omkoi-queue-runner only)
#   - Workload Identity pool github-actions + OIDC provider github-main, accepting only
#     this repository, refs/heads/main, deploy.yml and the GitHub environment "demo"
# Run AFTER deploy/deploy.sh (it needs omkoi-queue-runner and the Artifact Registry repo).
#
# Usage:
#   DRY_RUN=1 bash deploy/setup-wif.sh   # print every gcloud command, change nothing
#   bash deploy/setup-wif.sh             # apply, then print the 4 GitHub "demo" variables
#
# Environment (optional): PROJECT_ID (default: active gcloud project), REGION (asia-southeast1),
#   GITHUB_OWNER, GITHUB_REPO, REPO_ID, OWNER_ID, ENV_NAME (demo).
# The IDs are public numbers from: gh api repos/MANGKONYOK/cafe-queue-services --jq '.id, .owner.id'
# ==============================================================================

DRY_RUN="${DRY_RUN:-0}"
REGION="${REGION:-asia-southeast1}"
GITHUB_OWNER="${GITHUB_OWNER:-MANGKONYOK}"
GITHUB_REPO="${GITHUB_REPO:-cafe-queue-services}"
REPO_ID="${REPO_ID:-1450043053}"
OWNER_ID="${OWNER_ID:-183930344}"
ENV_NAME="${ENV_NAME:-demo}"

run_cmd() {
  if [ "$DRY_RUN" = "1" ]; then printf '[DRY_RUN] '; else printf '+ '; fi
  printf '%q ' "$@"
  printf '\n'
  if [ "$DRY_RUN" != "1" ]; then "$@"; fi
}

if [ "$DRY_RUN" = "1" ]; then
  PROJECT_ID="${PROJECT_ID:-example-gcp-project}"
  PROJECT_NUMBER="123456789012"
else
  PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
  if [ -z "$PROJECT_ID" ]; then
    echo "Error: PROJECT_ID is not set and no active gcloud project was found." >&2
    exit 1
  fi
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
fi

# Names (must match deploy/deploy.sh, deploy/release.sh and .github/workflows/deploy.yml)
REPO_NAME="omkoi-queue"
RUNNER_EMAIL="omkoi-queue-runner@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOYER_NAME="omkoi-queue-deployer"
DEPLOYER_EMAIL="${DEPLOYER_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_ID="github-actions"
PROVIDER_ID="github-main"
PROVIDER_PATH="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

# Only main, only deploy.yml, only environment demo, only this repository (immutable subject format).
CONDITION="assertion.repository_id == '${REPO_ID}' && assertion.repository_owner_id == '${OWNER_ID}' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '${GITHUB_OWNER}/${GITHUB_REPO}/.github/workflows/deploy.yml@refs/heads/main' && assertion.sub == 'repo:${GITHUB_OWNER}@${OWNER_ID}/${GITHUB_REPO}@${REPO_ID}:environment:${ENV_NAME}'"

exists() { [ "$DRY_RUN" != "1" ] && "$@" >/dev/null 2>&1; }

echo "Project ${PROJECT_ID} (${PROJECT_NUMBER}) · repo ${GITHUB_OWNER}/${GITHUB_REPO} (${REPO_ID}) · environment ${ENV_NAME} · dry run ${DRY_RUN}"
echo "Attribute condition (read it before applying):"
echo "  ${CONDITION}"

# 1. APIs used by the token exchange
run_cmd gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project "$PROJECT_ID"

# 2. Deployer service account
if ! exists gcloud iam service-accounts describe "$DEPLOYER_EMAIL" --project "$PROJECT_ID"; then
  run_cmd gcloud iam service-accounts create "$DEPLOYER_NAME" \
    --display-name="Omkoi Station GitHub deployer (WIF, no keys)" --project "$PROJECT_ID"
fi

# 3. Least-privilege roles
run_cmd gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER_EMAIL}" --role="roles/run.developer" --condition=None --format=none --quiet
run_cmd gcloud artifacts repositories add-iam-policy-binding "$REPO_NAME" \
  --location "$REGION" --member="serviceAccount:${DEPLOYER_EMAIL}" \
  --role="roles/artifactregistry.writer" --project "$PROJECT_ID" --format=none --quiet
run_cmd gcloud iam service-accounts add-iam-policy-binding "$RUNNER_EMAIL" \
  --member="serviceAccount:${DEPLOYER_EMAIL}" --role="roles/iam.serviceAccountUser" --project "$PROJECT_ID" --format=none --quiet

# 4. Workload Identity pool and OIDC provider
if ! exists gcloud iam workload-identity-pools describe "$POOL_ID" --location=global --project "$PROJECT_ID"; then
  run_cmd gcloud iam workload-identity-pools create "$POOL_ID" \
    --location=global --display-name="GitHub Actions" --project "$PROJECT_ID"
fi
if ! exists gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
    --workload-identity-pool="$POOL_ID" --location=global --project "$PROJECT_ID"; then
  run_cmd gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --workload-identity-pool="$POOL_ID" --location=global \
    --display-name="GitHub main" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" \
    --attribute-condition="$CONDITION" \
    --project "$PROJECT_ID"
else
  run_cmd gcloud iam workload-identity-pools providers update-oidc "$PROVIDER_ID" \
    --workload-identity-pool="$POOL_ID" --location=global \
    --attribute-condition="$CONDITION" --project "$PROJECT_ID"
fi

# 5. Only identities from this repository may impersonate the deployer
run_cmd gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository_id/${REPO_ID}" \
  --project "$PROJECT_ID" --format=none --quiet

# 6. The deployer must have no keys
if [ "$DRY_RUN" != "1" ]; then
  KEYS="$(gcloud iam service-accounts keys list --iam-account="$DEPLOYER_EMAIL" --managed-by=user --project "$PROJECT_ID" --format='value(name)')"
  if [ -n "$KEYS" ]; then
    echo "ERROR: ${DEPLOYER_EMAIL} has user-managed keys. Delete them; WIF needs none." >&2
    exit 1
  fi
fi

printf '\n%s\n' "GitHub -> Settings -> Environments -> ${ENV_NAME} (deployment branch: main) -> variables (not secrets):"
printf '  %-20s %s\n' GCP_PROJECT_ID "$PROJECT_ID" GCP_REGION "$REGION" WIF_PROVIDER "$PROVIDER_PATH" WIF_SERVICE_ACCOUNT "$DEPLOYER_EMAIL"
