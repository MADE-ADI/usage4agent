#!/usr/bin/env bash
set -euo pipefail

mytoken_tmp=''

fail() {
  echo "$*" >&2
  exit 1
}

run_setup() {
  local setup="$1"
  shift
  local no_input=false
  local argument
  for argument in "$@"; do
    if [[ "$argument" == '--no-input' ]]; then no_input=true; fi
  done

  # curl occupies stdin. Reopen the controlling terminal only for the Node
  # installer, after Bash has read this entire script and its final main call.
  if [[ "$no_input" == false && ! -t 0 && -t 1 ]] && ( : </dev/tty ) 2>/dev/null; then
    node "$setup" "$@" </dev/tty
  else
    node "$setup" "$@"
  fi
}

main() {
  local arguments=("$@")
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help|-h)
        cat <<'HELP'
Instal /mytoken dari GitHub:
  curl -fsSL https://raw.githubusercontent.com/MADE-ADI/usage4agent/main/install.sh | bash

Opsi: --no-input, --version v1|v2
Contoh: curl -fsSL https://raw.githubusercontent.com/MADE-ADI/usage4agent/main/install.sh | bash -s -- --version v2
Override sumber: MYTOKEN_REPOSITORY=owner/repo dan MYTOKEN_REF=branch/tag/commit.
Node.js 22+, npm, curl, dan tar diperlukan untuk instalasi via curl.
HELP
        return
        ;;
      --no-input) shift ;;
      --version)
        [[ "${2:-}" == v1 || "${2:-}" == v2 ]] || fail 'Versi harus v1 atau v2.'
        shift 2
        ;;
      *) fail 'Argumen tidak dikenal. Gunakan --help, --no-input, atau --version v1|v2.' ;;
    esac
  done

  command -v node >/dev/null 2>&1 || fail 'Node.js 22+ diperlukan. Instal Node.js, lalu jalankan installer kembali.'
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail 'Node.js 22+ diperlukan.'
  command -v npm >/dev/null 2>&1 || fail 'npm diperlukan. Instal npm, lalu jalankan installer kembali.'

  local source_file="${BASH_SOURCE[0]:-}"
  local script_dir=''
  if [[ -n "$source_file" && -f "$source_file" ]]; then
    script_dir="$(cd -- "$(dirname -- "$source_file")" && pwd)"
  fi
  if [[ -n "$script_dir" && -f "$script_dir/scripts/install.mjs" && -f "$script_dir/package.json" ]]; then
    run_setup "$script_dir/scripts/install.mjs" "${arguments[@]}"
    return
  fi

  command -v curl >/dev/null 2>&1 || fail 'curl diperlukan untuk mengunduh repo.'
  command -v tar >/dev/null 2>&1 || fail 'tar diperlukan untuk mengekstrak repo.'

  local repository="${MYTOKEN_REPOSITORY:-MADE-ADI/usage4agent}"
  local ref="${MYTOKEN_REF:-main}"
  [[ "$repository" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+$ ]] || fail 'MYTOKEN_REPOSITORY harus berformat owner/repo.'
  [[ "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9_./-]*$ && "$ref" != *..* ]] || fail 'MYTOKEN_REF harus berupa branch, tag, atau commit yang valid.'

  mytoken_tmp="$(mktemp -d "${TMPDIR:-/tmp}/opencode-mytoken.XXXXXXXX")"
  trap 'rm -rf -- "$mytoken_tmp"' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  echo "Mengunduh ${repository} (${ref})…"
  curl --fail --silent --show-error --location --retry 2 --connect-timeout 10 --max-time 120 \
    --proto '=https' --tlsv1.2 \
    "https://codeload.github.com/${repository}/tar.gz/${ref}" \
    --output "$mytoken_tmp/source.tar.gz"
  mkdir "$mytoken_tmp/source"
  tar -xzf "$mytoken_tmp/source.tar.gz" -C "$mytoken_tmp/source" --strip-components=1
  [[ -f "$mytoken_tmp/source/scripts/install.mjs" && -f "$mytoken_tmp/source/package.json" ]] || fail 'Arsip repo tidak berisi installer /mytoken.'
  run_setup "$mytoken_tmp/source/scripts/install.mjs" "${arguments[@]}"
}

main "$@"
