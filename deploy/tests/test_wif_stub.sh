#!/usr/bin/env bash
# Offline checks for deploy/setup-wif.sh (gcloud is stubbed; nothing reaches GCP).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WIF_SCRIPT="${SCRIPT_DIR}/../setup-wif.sh"
STATE="$(mktemp -d)"
trap 'rm -rf "$STATE"' EXIT
mkdir -p "$STATE/bin"

# Stub: logs every call; "describe" succeeds only when STUB_EXISTS=1; keys list prints KEYS.
cat > "$STATE/bin/gcloud" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GCLOUD_LOG"
case "$*" in
  "config get-value project") echo stub-project ;;
  "projects describe"*) echo 987654321098 ;;
  *" describe "*|*" describe") [ "${STUB_EXISTS:-0}" = 1 ] || exit 1 ;;
  *"keys list"*) printf '%s' "${STUB_KEYS:-}" ;;
esac
exit 0
STUB
chmod +x "$STATE/bin/gcloud"
export PATH="$STATE/bin:$PATH"

fail() { echo "FAIL: $*" >&2; exit 1; }
has() { grep -qF -- "$1" "$2" || fail "expected '$1' in $2"; }
hasnt() { if grep -qF -- "$1" "$2"; then fail "unexpected '$1' in $2"; fi; }

# 1. Dry run: prints the plan, calls gcloud zero times.
export GCLOUD_LOG="$STATE/dry.log"; : > "$GCLOUD_LOG"
DRY_RUN=1 bash "$WIF_SCRIPT" > "$STATE/dry.out"
[ ! -s "$GCLOUD_LOG" ] || fail "dry run called gcloud"
has "assertion.repository_id == '1450043053'" "$STATE/dry.out"
has ":environment:demo'" "$STATE/dry.out"
echo "PASS dry run makes no gcloud calls and prints the attribute condition"

# 2. First run: creates the account, pool and provider; least-privilege bindings; no key is created.
export GCLOUD_LOG="$STATE/first.log"; : > "$GCLOUD_LOG"
bash "$WIF_SCRIPT" > "$STATE/first.out"
has "iam service-accounts create omkoi-queue-deployer" "$GCLOUD_LOG"
has "iam workload-identity-pools create github-actions" "$GCLOUD_LOG"
has "providers create-oidc github-main" "$GCLOUD_LOG"
has "--issuer-uri=https://token.actions.githubusercontent.com" "$GCLOUD_LOG"
has "assertion.ref == 'refs/heads/main'" "$GCLOUD_LOG"
has "workflows/deploy.yml@refs/heads/main" "$GCLOUD_LOG"
has "--role=roles/run.developer" "$GCLOUD_LOG"
has "artifacts repositories add-iam-policy-binding omkoi-queue" "$GCLOUD_LOG"
has "--role=roles/iam.serviceAccountUser" "$GCLOUD_LOG"
has "principalSet://iam.googleapis.com/projects/987654321098/locations/global/workloadIdentityPools/github-actions/attribute.repository_id/1450043053" "$GCLOUD_LOG"
hasnt "keys create" "$GCLOUD_LOG"
hasnt "roles/owner" "$GCLOUD_LOG"
hasnt "roles/editor" "$GCLOUD_LOG"
hasnt "secretmanager" "$GCLOUD_LOG"
has "projects/987654321098/locations/global/workloadIdentityPools/github-actions/providers/github-main" "$STATE/first.out"
has "omkoi-queue-deployer@stub-project.iam.gserviceaccount.com" "$STATE/first.out"
echo "PASS first run creates pool, provider and deployer with least privilege and no key"

# 3. Re-run: existing resources are not recreated; the provider condition is updated.
export GCLOUD_LOG="$STATE/rerun.log"; : > "$GCLOUD_LOG"
STUB_EXISTS=1 bash "$WIF_SCRIPT" > /dev/null
hasnt "service-accounts create" "$GCLOUD_LOG"
hasnt "workload-identity-pools create " "$GCLOUD_LOG"
hasnt "create-oidc" "$GCLOUD_LOG"
has "providers update-oidc github-main" "$GCLOUD_LOG"
echo "PASS re-run is idempotent"

# 4. A user-managed key on the deployer stops the script.
export GCLOUD_LOG="$STATE/key.log"; : > "$GCLOUD_LOG"
if STUB_EXISTS=1 STUB_KEYS="projects/p/serviceAccounts/x/keys/abc" bash "$WIF_SCRIPT" > /dev/null 2>&1; then
  fail "a deployer key was not rejected"
fi
echo "PASS a deployer key is rejected"
