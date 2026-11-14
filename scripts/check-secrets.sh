#!/usr/bin/env bash
# TEST-20 (NFR-02): fail when a tracked file holds something that looks like a real secret.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0
self=':!scripts/check-secrets.sh'

# 1. Private keys.
if git grep -nIE 'BEGIN [A-Z ]*PRIVATE KEY' -- . "$self"; then fail=1; fi

# 2. .env.example files are templates: key names only, every value empty.
if git grep -nIE '^\s*[A-Z][A-Z0-9_]*\s*=\s*[^[:space:]]' -- '*.env.example'; then fail=1; fi

# 3. Secret keys assigned a value anywhere else.
if git grep -nIE '^\s*(SESSION_SECRET|POSTGRES_PASSWORD|SEED_[A-Z_]+_PASSWORD)\s*[=:]\s*[^[:space:]]' -- . "$self"; then fail=1; fi

# 4. Connection strings with an embedded password (scheme://user:password@host).
if git grep -nIE '[a-z]+://[^/[:space:]:@`<]+:[^@[:space:]`<]+@' -- . "$self"; then fail=1; fi

# 5. Committed .env files (only .env.example is allowed).
if git ls-files | grep -E '(^|/)\.env(\.[^/]*)?$' | grep -vE '\.env\.example$'; then fail=1; fi

if [ "$fail" -ne 0 ]; then
  echo "check-secrets: possible secret committed (see lines above)" >&2
  exit 1
fi
echo "check-secrets: no secrets found in $(git ls-files | wc -l | tr -d ' ') tracked files"
