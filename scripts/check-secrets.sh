#!/usr/bin/env bash
# TEST-20 (NFR-02): fail when a tracked file holds something that looks like a real secret.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0
self=':!scripts/check-secrets.sh'

# 1. Private keys.
if git grep -nIE 'BEGIN [A-Z ]*PRIVATE KEY' -- . "$self"; then fail=1; fi

# 2. .env.example files are templates: key names only, every value empty.
if git grep -nIE '^[[:space:]]*[A-Z][A-Z0-9_]*[[:space:]]*=[[:space:]]*[^[:space:]]' -- '*.env.example'; then fail=1; fi

# 3. Secret keys assigned a value anywhere else (ignore the Zod schema, the runtime generator and
#    values read from the environment at run time, e.g. the Playwright config).
if git grep -nIE '^[[:space:]]*(SESSION_SECRET|POSTGRES_PASSWORD|SEED_[A-Z_]+_PASSWORD)[[:space:]]*[=:][[:space:]]*[^[:space:]]' -- . "$self" | grep -vE ':[[:space:]]*((z\.string|randomBytes)\(|process\.env\.)'; then fail=1; fi

# 4. Connection strings with an embedded password (scheme://user:password@host), ignoring shell variable passwords.
if git grep -nIE '[a-z]+://[^/[:space:]:@`<]+:[^@[:space:]`<]+@' -- . "$self" | grep -vE '://[^/[:space:]:@]+:\$\{[A-Za-z_][A-Za-z0-9_]*\}@'; then fail=1; fi

# 5. Committed .env files (only .env.example is allowed).
if git ls-files | grep -E '(^|/)\.env(\.[^/]*)?$' | grep -vE '\.env\.example$'; then fail=1; fi

# 6. The ignore rules must keep real env files and dependencies out of Git.
for p in server/.env client/.env server/node_modules/ client/node_modules/ e2e/node_modules/; do
  if ! git check-ignore -q --no-index "$p"; then echo "$p is not ignored by .gitignore"; fail=1; fi
done

if [ "$fail" -ne 0 ]; then
  echo "check-secrets: possible secret committed (see lines above)" >&2
  exit 1
fi
echo "check-secrets: no secrets found in $(git ls-files | wc -l | tr -d ' ') tracked files"
