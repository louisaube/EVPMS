#!/usr/bin/env bash
# Écrit api/.env.development et api/.env.test à partir de api/.env.template (git-ignorés), puis la variante par défaut
# de la recette (acceptance/variants.yaml) dans api/.env.test. Crée aussi les bases <slug> et <slug>_test.
# Usage : bash scripts/envs.sh   (PostgreSQL 16 sur localhost:5432, rôle database / database)
set -e
cd "$(dirname "$0")/.."
PG_ROLE=database; PG_PASSWORD=database
s="$(python3 -c "import json;print(json.load(open('package.json'))['name'])")"
[ -f api/.env.template ] || { echo "api/.env.template absent" >&2; exit 1; }
for db in "$s" "${s}_test"; do PGPASSWORD=$PG_PASSWORD psql -h localhost -U $PG_ROLE -d postgres -qc "create database $db" >/dev/null 2>&1 || true; done
for env in development test; do
  db="$s"; [ "$env" = test ] && db="${s}_test"
  grep -q "localhost:5432/$db\b" "api/.env.$env" 2>/dev/null && continue
  sed -e "s#^DATABASE_URL=.*#DATABASE_URL=postgres://$PG_ROLE:$PG_PASSWORD@localhost:5432/$db#" \
      -e "s/^JWT_SECRET=.*/JWT_SECRET=$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)/" \
      -e "s/^COOKIE_SECRET=.*/COOKIE_SECRET=$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)/" \
      api/.env.template > "api/.env.$env"
done
[ -f acceptance/variants.yaml ] && python3 scripts/variantes.py env
echo "api/.env.development et api/.env.test prêts"
