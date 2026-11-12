#!/usr/bin/env bash
# Instala o CotaBar.
#   ./instalar.sh            applet + coletor só para o seu usuário
#   sudo ./instalar.sh --root   também instala o coletor do sistema e o timer
#                               que lê as IAs logadas na conta root
#   ./instalar.sh --remover  (ou sudo ... --remover) desfaz
#   --usuario NOME           dono do painel, quando já está como root sem sudo
set -euo pipefail

UUID="cotabar@davicjc"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODO="usuario"
REMOVER=0
ALVO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) MODO="root" ;;
    --remover) REMOVER=1 ;;
    --usuario) ALVO="${2:-}"; shift ;;
    --usuario=*) ALVO="${1#*=}" ;;
    -h|--help) sed -n 2,7p "$0"; exit 0 ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
  shift
done

# Usuário dono do painel: --usuario, quem chamou o sudo, o dono da sessão, ou você mesmo.
if [[ $EUID -eq 0 ]]; then
  if [[ -z "$ALVO" ]]; then
    ALVO="${SUDO_USER:-}"
    [[ "$ALVO" == root ]] && ALVO=""
    [[ -n "$ALVO" ]] || ALVO="$(logname 2>/dev/null || true)"
    [[ "$ALVO" == root ]] && ALVO=""
  fi
  [[ -n "$ALVO" ]] || { echo "não sei quem é o dono do painel: use --usuario NOME" >&2; exit 1; }
  id -u "$ALVO" >/dev/null 2>&1 || { echo "usuário não existe: $ALVO" >&2; exit 1; }
else
  [[ -z "$ALVO" || "$ALVO" == "$(id -un)" ]] || { echo "--usuario de outra pessoa precisa de sudo" >&2; exit 1; }
  ALVO="$(id -un)"
  [[ "$MODO" == usuario ]] || { echo "--root precisa de sudo" >&2; exit 1; }
fi
ALVO_UID="$(id -u "$ALVO")"
ALVO_HOME="$(getent passwd "$ALVO" | cut -d: -f6)"

como_alvo() {
  if [[ $EUID -eq 0 ]]; then
    sudo -u "$ALVO" -H env DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$ALVO_UID/bus" "$@"
  else
    "$@"
  fi
}

DESTINO="$ALVO_HOME/.local/share/cinnamon/applets/$UUID"

painel() {  # liga/desliga o applet no painel sem reiniciar o Cinnamon
  como_alvo python3 -I - "$UUID" "$1" <<'PY'
import ast, subprocess, sys
uuid, acao = sys.argv[1], sys.argv[2]
atual = ast.literal_eval(subprocess.check_output(
    ["gsettings", "get", "org.cinnamon", "enabled-applets"], text=True).strip() or "[]")
tem = [x for x in atual if x.split(":")[3] == uuid]
if acao == "ligar" and not tem:
    prox = max([int(x.split(":")[4]) for x in atual if x.split(":")[4].isdigit()] + [0]) + 1
    atual.append(f"panel1:right:0:{uuid}:{prox}")
elif acao == "desligar" and tem:
    atual = [x for x in atual if x not in tem]
else:
    sys.exit(0)
subprocess.check_call(["gsettings", "set", "org.cinnamon", "enabled-applets", str(atual)])
PY
}

if [[ $REMOVER -eq 1 ]]; then
  painel desligar || true
  rm -rf "$DESTINO"
  if [[ $EUID -eq 0 ]]; then
    systemctl disable --now cotabar-root.timer 2>/dev/null || true
    rm -f /etc/systemd/system/cotabar-root.{service,timer} /usr/local/bin/cotabar-coletor
    systemctl daemon-reload
    rm -rf /var/lib/cotabar
  fi
  echo "CotaBar removido."
  exit 0
fi

# Applet (do usuário)
como_alvo mkdir -p "$DESTINO"
como_alvo cp "$AQUI/applet/$UUID/"{applet.js,metadata.json,settings-schema.json,stylesheet.css} "$DESTINO/"
[[ -f "$AQUI/applet/$UUID/icon.png" ]] && como_alvo cp "$AQUI/applet/$UUID/icon.png" "$DESTINO/"
como_alvo install -m 0755 "$AQUI/coletor/cotabar-coletor" "$DESTINO/cotabar-coletor"

if [[ "$MODO" == root ]]; then
  # Fora do alcance do usuário: o root executa este arquivo.
  install -o root -g root -m 0755 "$AQUI/coletor/cotabar-coletor" /usr/local/bin/cotabar-coletor
  install -o root -g root -m 0644 "$AQUI/systemd/cotabar-root.service" "$AQUI/systemd/cotabar-root.timer" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now cotabar-root.timer
  systemctl start cotabar-root.service || true
fi

painel ligar
# Se já estava no painel, recarrega o código novo.
como_alvo dbus-send --session --dest=org.Cinnamon --type=method_call /org/Cinnamon \
  org.Cinnamon.ReloadXlet string:"$UUID" string:APPLET >/dev/null 2>&1 || true

echo "CotaBar instalado ($MODO)."
