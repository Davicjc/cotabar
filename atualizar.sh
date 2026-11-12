#!/usr/bin/env bash
# Updates CotaBar from GitHub.
#   atualizar.sh --check   prints "local=X remote=Y" and exits
#   atualizar.sh           pulls the latest version and reinstalls it
#   atualizar.sh --no-root same, but leaves the root timer alone (no password prompt)
# Installed by instalar.sh to ~/.local/share/cotabar/atualizar.sh; the applet's
# "Check for updates" menu item calls it. Only ever talks to github.com/Davicjc/cotabar.
set -euo pipefail

UUID="cotabar@davicjc"
REPO="https://github.com/Davicjc/cotabar"
RAW="https://raw.githubusercontent.com/Davicjc/cotabar/main/applet/$UUID/metadata.json"
DADOS="${XDG_DATA_HOME:-$HOME/.local/share}/cotabar"
APPLET="${XDG_DATA_HOME:-$HOME/.local/share}/cinnamon/applets/$UUID"

versao_de() {  # lê "version" de um metadata.json (arquivo ou stdin)
  python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]) if len(sys.argv)>1 else sys.stdin).get("version","0"))' "$@"
}

baixar() {  # curl ou, sem curl, Python
  if command -v curl >/dev/null; then
    curl -fsSL --max-time 30 "$1"
  else
    python3 -I -c 'import sys,urllib.request; sys.stdout.buffer.write(urllib.request.urlopen(sys.argv[1], timeout=30).read())' "$1"
  fi
}

SEM_ROOT=0
[[ "${1:-}" == "--no-root" ]] && SEM_ROOT=1

local_v="$(versao_de "$APPLET/metadata.json" 2>/dev/null || echo 0)"

if [[ "${1:-}" == "--check" ]]; then
  remota="$(baixar "$RAW" | versao_de)"
  echo "local=$local_v remote=$remota"
  exit 0
fi

# 1) Código novo: o clone de onde foi instalado (git pull) ou o pacote do GitHub.
ORIGEM="$(cat "$DADOS/origem" 2>/dev/null || true)"
if [[ -n "$ORIGEM" && -d "$ORIGEM/.git" ]] \
   && git -C "$ORIGEM" remote get-url origin 2>/dev/null | grep -qiE 'github\.com[/:]Davicjc/cotabar(\.git)?$'; then
  echo "git pull em $ORIGEM"
  git -C "$ORIGEM" pull --ff-only
  SRC="$ORIGEM"
else
  SRC="$(mktemp -d "${TMPDIR:-/tmp}/cotabar-XXXXXX")"
  trap 'rm -rf "$SRC"' EXIT
  echo "baixando $REPO (main)"
  baixar "$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$SRC" --strip-components=1
fi

# 2) Reinstala. Com o timer do root instalado, atualiza ele também (pede senha uma vez).
if [[ $SEM_ROOT -eq 0 && -f /etc/systemd/system/cotabar-root.timer ]] && command -v pkexec >/dev/null; then
  pkexec "$SRC/instalar.sh" --root --user "$(id -un)"
else
  "$SRC/instalar.sh"
fi
echo "atualizado: $local_v -> $(versao_de "$APPLET/metadata.json")"
