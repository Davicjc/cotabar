#!/usr/bin/env python3
"""Compiles a simple .po (msgid/msgstr, no plurals) into .mo when msgfmt is missing.

Usage: po2mo.py input.po output.mo
"""
import ast
import struct
import sys


def ler_po(caminho):
    pares, atual, campo = {}, {"msgid": "", "msgstr": ""}, None
    with open(caminho, encoding="utf-8") as fh:
        for linha in fh:
            linha = linha.strip()
            if not linha or linha.startswith("#"):
                continue
            for chave in ("msgid", "msgstr"):
                if linha.startswith(chave + " "):
                    if chave == "msgid" and campo == "msgstr":
                        pares[atual["msgid"]] = atual["msgstr"]
                        atual = {"msgid": "", "msgstr": ""}
                    campo = chave
                    linha = linha[len(chave):].strip()
                    break
            if linha.startswith('"') and campo:
                atual[campo] += ast.literal_eval(linha)
    if campo == "msgstr":
        pares[atual["msgid"]] = atual["msgstr"]
    return {k: v for k, v in pares.items() if v}


def gravar_mo(pares, caminho):
    chaves = sorted(pares)
    ids = [k.encode() for k in chaves]
    strs = [pares[k].encode() for k in chaves]
    n = len(chaves)
    inicio_ids = 7 * 4
    inicio_strs = inicio_ids + n * 8
    dados = inicio_strs + n * 8
    tab_ids, tab_strs, corpo = [], [], b""
    for b in ids:
        tab_ids.append((len(b), dados + len(corpo)))
        corpo += b + b"\0"
    for b in strs:
        tab_strs.append((len(b), dados + len(corpo)))
        corpo += b + b"\0"
    cab = struct.pack("<7I", 0x950412DE, 0, n, inicio_ids, inicio_strs, 0, 0)
    tabelas = b"".join(struct.pack("<2I", *x) for x in tab_ids + tab_strs)
    with open(caminho, "wb") as fh:
        fh.write(cab + tabelas + corpo)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    gravar_mo(ler_po(sys.argv[1]), sys.argv[2])
