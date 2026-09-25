#!/usr/bin/env bash
# Valide la configuration YengaPay Sandbox.
# - Vérifie que les variables d'environnement attendues sont présentes.
# - Lance les tests vitest d'intégration sandbox (credentials + checkout + direct deposit).
# - Affiche un rapport coloré.
#
# Usage :
#   ./scripts/validate-yengapay-sandbox.sh
#   YENGAPAY_BASE_URL=https://api.sandbox.yengapay.com/api/v1 \
#     ./scripts/validate-yengapay-sandbox.sh
#
# Pré-requis :
#   - node + pnpm/npm installés (le script invoque `pnpm test` ou `npx vitest run`).
#   - Variables d'env : YENGAPAY_MODE=sandbox, YENGAPAY_API_KEY, YENGAPAY_ORG_ID,
#     YENGAPAY_PROJECT_ID.
#
# Sortie : exit 0 si tout est OK, 1 sinon.

set -uo pipefail

# Couleurs ANSI
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { printf "${BLUE}[validate]${NC} %s\n" "$*"; }
ok() { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$*"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$*"; }

cd "$(dirname "$0")/.." || { fail "Impossible de se placer à la racine du repo."; exit 1; }

echo
info "=== Validation YengaPay Sandbox ==="
echo

# ---- Étape 1 : variables d'environnement ----
info "Étape 1/4 : variables d'environnement"
MISSING=0
for var in YENGAPAY_MODE YENGAPAY_API_KEY YENGAPAY_ORG_ID YENGAPAY_PROJECT_ID; do
  if [ -z "${!var:-}" ]; then
    fail "Variable $var non définie"
    MISSING=$((MISSING+1))
  else
    value="${!var}"
    if [ "$var" = "YENGAPAY_API_KEY" ]; then
      masked="${value:0:4}***(longueur ${#value})"
    else
      masked="$value"
    fi
    ok "$var=$masked"
  fi
done

if [ "$MISSING" -gt 0 ]; then
  fail "Variables manquantes. Voir docs/yengapay-sandbox-setup.md."
  exit 1
fi
echo

if [ "${YENGAPAY_MODE}" != "sandbox" ]; then
  warn "YENGAPAY_MODE=$YENGAPAY_MODE (différent de 'sandbox'). Le test va quand même tourner mais ciblera $YENGAPAY_MODE."
fi
echo

# ---- Étape 2 : base URL ----
info "Étape 2/4 : URL de base"
BASE_URL="${YENGAPAY_BASE_URL:-https://api.sandbox.yengapay.com/api/v1}"
ok "YENGAPAY_BASE_URL=$BASE_URL"

# Sanity check : doit finir par /api/v1
if [[ ! "$BASE_URL" =~ /api/v1$ ]]; then
  warn "L'URL ne se termine pas par /api/v1 — vérifier la console YengaPay."
fi
echo

# ---- Étape 3 : détecteur de runner de tests ----
info "Étape 3/4 : détection du runner de tests"
RUNNER=""
if command -v pnpm >/dev/null 2>&1 && [ -f pnpm-lock.yaml ]; then
  RUNNER="pnpm"
elif command -v npx >/dev/null 2>&1; then
  RUNNER="npx"
elif command -v vitest >/dev/null 2>&1; then
  RUNNER="vitest"
fi

if [ -z "$RUNNER" ]; then
  fail "Aucun runner de tests trouvé. Installer pnpm, npx, ou vitest."
  exit 1
fi
ok "Runner détecté : $RUNNER"
echo

# ---- Étape 4 : exécution des tests sandbox ----
info "Étape 4/4 : exécution des tests sandbox"

TESTS=(
  "tests/yengapay-sandbox-credentials.test.ts"
  "tests/yengapay-sandbox-checkout.test.ts"
  "tests/yengapay-sandbox-direct-deposit.test.ts"
)

# On active les tests gated par variables d'env
export YENGAPAY_RUN_SANDBOX_CHECKOUT_TEST=true
export YENGAPAY_RUN_SANDBOX_DIRECT_DEPOSIT_TEST=true

TEST_FAILED=0
for test_file in "${TESTS[@]}"; do
  info "  → $test_file"
  case "$RUNNER" in
    pnpm)
      if ! pnpm exec vitest run "$test_file" 2>&1; then
        TEST_FAILED=$((TEST_FAILED+1))
      fi
      ;;
    npx)
      if ! npx --no-install vitest run "$test_file" 2>/dev/null && ! npx vitest run "$test_file" 2>&1; then
        TEST_FAILED=$((TEST_FAILED+1))
      fi
      ;;
    vitest)
      if ! vitest run "$test_file" 2>&1; then
        TEST_FAILED=$((TEST_FAILED+1))
      fi
      ;;
  esac
  echo
done

# ---- Résumé ----
echo
info "=== Résumé ==="
if [ "$TEST_FAILED" -eq 0 ]; then
  ok "Tous les tests sandbox ont réussi."
  echo
  info "Étapes suivantes :"
  echo "  1. Smoke test webhook local : YENGAPAY_WEBHOOK_SECRET=<secret> BASE_URL=http://localhost:3000 \\"
  echo "       node scripts/smoke-test-yengapay-webhook.mjs"
  echo "  2. Configurer l'URL webhook https://<host>/api/webhooks/yengapay dans la console YengaPay."
  echo "  3. Tester end-to-end avec un vrai numéro Mobile Money sandbox."
  exit 0
else
  fail "$TEST_FAILED fichier(s) de test ont échoué."
  echo
  info "Debug :"
  echo "  - Logs serveur Tikis (filtrer 'webhook:yengapay')"
  echo "  - Console YengaPay → vérifier que les credentials sandbox sont valides"
  echo "  - tests/yengapay-config.test.ts → vérifier la lecture des env vars"
  exit 1
fi
