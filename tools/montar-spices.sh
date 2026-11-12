#!/usr/bin/env bash
# Monta a pasta do CotaBar no formato do Cinnamon Spices:
#   tools/montar-spices.sh DESTINO   ->  DESTINO/cotabar@davicjc/{info.json,README.md,screenshot.png,files/...}
# Tira o código entre os marcadores [atualizador-github] (no Spices quem atualiza é a loja,
# e a regra deles não deixa o applet baixar código de fora).
set -euo pipefail
UUID="cotabar@davicjc"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:?uso: montar-spices.sh DESTINO}/$UUID"
rm -rf "$DEST"
mkdir -p "$DEST/files/$UUID/po"
cp "$AQUI/spices/info.json" "$AQUI/spices/README.md" "$DEST/"
cp "$AQUI/docs/screenshot.png" "$DEST/screenshot.png"
A="$AQUI/applet/$UUID"
cp "$A/"{metadata.json,settings-schema.json,stylesheet.css,icon.png} "$DEST/files/$UUID/"
cp "$A/po/"*.po "$A/po/"*.pot "$DEST/files/$UUID/po/"
cp "$AQUI/coletor/cotabar-coletor" "$DEST/files/$UUID/cotabar-coletor"
python3 -I - "$A/applet.js" "$DEST/files/$UUID/applet.js" <<'PY'
import re, sys
s = open(sys.argv[1], encoding="utf-8").read()
s2 = re.sub(r"[ \t]*// \[atualizador-github\].*?// \[/atualizador-github\][ \t]*\n", "", s, flags=re.S)
assert "atualizador" not in s2.lower() and "ATUALIZADOR" not in s2, "sobrou código do atualizador"
open(sys.argv[2], "w", encoding="utf-8").write(s2)
PY
echo "montado em $DEST"
