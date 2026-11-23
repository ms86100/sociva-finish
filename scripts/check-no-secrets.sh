#!/usr/bin/env bash
# Optional local secret scan wrapper (CI uses gitleaks-action).
set -euo pipefail

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source . --no-git -v
  exit 0
fi

echo "gitleaks not installed; skip or run: https://github.com/gitleaks/gitleaks#installing"
exit 0