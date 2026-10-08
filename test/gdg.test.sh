#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/backend" "$fixture/frontend" "$fixture/bin"
cp "$root/gdg" "$root/.env.example" "$fixture/backend/"
touch "$fixture/frontend/package.json" "$fixture/frontend/pnpm-lock.yaml"
cat > "$fixture/bin/docker" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$GDG_TEST_CALLS"
SH
chmod +x "$fixture/bin/docker"
export PATH="$fixture/bin:$PATH"
export GDG_TEST_CALLS="$fixture/calls"
export FRONTEND_PATH="$fixture/frontend"

"$fixture/backend/gdg" backend run > /dev/null
grep -qE -- 'up .* db pgadmin backend$' "$GDG_TEST_CALLS"
if grep -q 'frontend' "$GDG_TEST_CALLS"; then
  printf '%s\n' 'Backend-only run unexpectedly starts frontend.' >&2
  exit 1
fi
test -f "$fixture/backend/.env"
test "$(ls -l "$fixture/backend/.env" | cut -c1-10)" = "-rw-------"
if grep -q 'CHANGE_ME' "$fixture/backend/.env"; then
  printf '%s\n' 'Generated .env still contains placeholder passwords.' >&2
  exit 1
fi
before=$(cksum < "$fixture/backend/.env")
: > "$GDG_TEST_CALLS"
"$fixture/backend/gdg" frontend run > /dev/null
grep -qE -- 'up .*--no-deps frontend$' "$GDG_TEST_CALLS"
test "$before" = "$(cksum < "$fixture/backend/.env")"

: > "$GDG_TEST_CALLS"
"$fixture/backend/gdg" run > /dev/null
grep -qE -- 'up .* db pgadmin backend frontend$' "$GDG_TEST_CALLS"

: > "$GDG_TEST_CALLS"
"$fixture/backend/gdg" backend stop
grep -qE -- 'stop db pgadmin backend$' "$GDG_TEST_CALLS"
if "$fixture/backend/gdg" frontend unknown > /dev/null 2>&1; then
  printf '%s\n' 'Unknown action was accepted.' >&2
  exit 1
fi

export GDG_BIN_DIR="$fixture/installed bin's"
export GDG_SHELL_RC="$fixture/shellrc"
"$fixture/backend/gdg" install > /dev/null
test -L "$GDG_BIN_DIR/gdg"
"$fixture/backend/gdg" install > /dev/null
test "$(grep -c '# GDG local platform command' "$GDG_SHELL_RC")" -eq 1
# A fresh shell should resolve the installed command from any working directory.
sh -c '. "$GDG_SHELL_RC"; cd /; gdg backend status'
grep -qE -- 'ps db pgadmin backend$' "$GDG_TEST_CALLS"
mkdir -p "$fixture/collision"
printf '%s\n' 'existing command' > "$fixture/collision/gdg"
original=$(cksum < "$fixture/collision/gdg")
if GDG_BIN_DIR="$fixture/collision" "$fixture/backend/gdg" install > /dev/null 2>&1; then
  printf '%s\n' 'Installer overwrote an existing command.' >&2
  exit 1
fi
test "$original" = "$(cksum < "$fixture/collision/gdg")"
printf '%s\n' 'Launcher checks passed: service scopes, env preservation, invalid actions, persistent installation, collision safety.'
