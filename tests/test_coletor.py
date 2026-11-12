"""Testes do cotabar-coletor: python3 -m unittest discover -s tests"""
import datetime as dt
import importlib.machinery
import importlib.util
import json
import os
import tempfile
import unittest
from unittest import mock

AQUI = os.path.dirname(os.path.abspath(__file__))
CAMINHO = os.path.join(AQUI, "..", "coletor", "cotabar-coletor")
_loader = importlib.machinery.SourceFileLoader("cotabar_coletor", CAMINHO)
_spec = importlib.util.spec_from_loader("cotabar_coletor", _loader)
assert _spec is not None
c = importlib.util.module_from_spec(_spec)
_loader.exec_module(c)

CLAUDE = {
    "five_hour": {"utilization": 81.0, "resets_at": "2026-11-11T22:20:00.177784+00:00"},
    "seven_day": {"utilization": 47.0, "resets_at": "2026-11-17T12:00:00.177803+00:00"},
    "extra_usage": {"is_enabled": False},
    "limits": [
        {"kind": "session", "percent": 81, "resets_at": "2026-11-11T22:20:00.177784+00:00"},
        {"kind": "weekly_all", "percent": 47, "resets_at": "2026-11-17T12:00:00.177803+00:00"},
        {"kind": "weekly_scoped", "percent": 13, "resets_at": "2026-11-17T12:00:00+00:00",
         "scope": {"model": {"display_name": "Fable"}}},
    ],
}

AGY = {"groups": [
    {"displayName": "Gemini Models", "buckets": [
        {"bucketId": "gemini-weekly", "window": "weekly", "resetTime": "2026-11-14T00:16:20Z",
         "remainingFraction": 0.9},
        {"bucketId": "gemini-5h", "window": "5h", "resetTime": "2026-11-11T23:25:29Z",
         "remainingFraction": 0.98}]},
    {"displayName": "Gemini 4 Argon", "buckets": [
        {"bucketId": "gemini-argon-wtu-weekly", "window": "weekly",
         "resetTime": "2026-11-16T03:16:03Z", "remainingFraction": 0.25},
        {"bucketId": "desligado", "window": "5h", "disabled": True, "remainingFraction": 0}]},
]}

CODEX = {"plan_type": "plus", "rate_limit": {
    "primary_window": {"used_percent": 12, "limit_window_seconds": 18000, "reset_after_seconds": 600},
    "secondary_window": {"used_percent": None, "limit_window_seconds": 604800, "reset_at": 1795000000},
}}

COPILOT = {"quota_reset_date": "2026-12-01", "quota_snapshots": {
    "chat": {"unlimited": True, "percent_remaining": 100},
    "premium_interactions": {"unlimited": False, "percent_remaining": 75.0,
                             "remaining": 150, "entitlement": 200},
}}


class Datas(unittest.TestCase):
    def test_fracao_longa_e_z(self):
        d = c.ler_data("2026-11-11T22:20:00.177784123+00:00")
        self.assertEqual(d.hour, 22)
        self.assertEqual(c.ler_data("2026-11-14T00:16:20Z").tzinfo, dt.timezone.utc)

    def test_nanossegundos_com_fuso(self):
        d = c.ler_data("2026-11-12T09:22:48.791236579-03:00")
        self.assertEqual(c.iso(d), "2026-11-12T12:22:48+00:00")

    def test_epoch_ms_e_s(self):
        self.assertEqual(c.ler_data(1794447907765), c.ler_data(1794447907.765))

    def test_lixo(self):
        self.assertIsNone(c.ler_data("ontem"))
        self.assertIsNone(c.ler_data(None))


class Parsers(unittest.TestCase):
    def test_claude(self):
        js = {j["id"]: j for j in c.janelas_claude(CLAUDE)}
        self.assertEqual(js["sessao"]["usado"], 81)
        self.assertEqual(js["sessao"]["tipo"], "curta")
        self.assertEqual(js["semana"]["tipo"], "longa")
        self.assertIn("semana-fable", js)
        self.assertEqual([js[k]["periodo"] for k in ("sessao", "semana")], ["H", "S"])

    def test_claude_formato_antigo(self):
        antigo = {k: v for k, v in CLAUDE.items() if k != "limits"}
        js = {j["id"]: j for j in c.janelas_claude(antigo)}
        self.assertEqual(set(js), {"sessao", "semana"})

    def test_agy_usa_o_que_sobra(self):
        js = {j["id"]: j for j in c.janelas_agy(AGY)}
        self.assertAlmostEqual(js["gemini-5h"]["usado"], 2.0)
        self.assertEqual(js["gemini-5h"]["tipo"], "curta")
        self.assertAlmostEqual(js["gemini-argon-wtu-weekly"]["usado"], 75.0)
        self.assertNotIn("desligado", js)

    def test_codex_janela_nula_nao_derruba_a_outra(self):
        js = c.janelas_codex(CODEX)
        self.assertEqual(len(js), 1)
        self.assertEqual(js[0]["tipo"], "curta")
        self.assertIsNotNone(js[0]["reinicia"])

    def test_copilot_ignora_ilimitado(self):
        js = c.janelas_copilot(COPILOT)
        self.assertEqual([j["id"] for j in js], ["premium_interactions"])
        self.assertEqual(js[0]["usado"], 25.0)
        self.assertEqual(js[0]["detalhe"], "150 de 200 restantes")
        self.assertEqual(js[0]["periodo"], "M")

    def test_copilot_remaining_nulo(self):
        q = {"quota_snapshots": {"premium_interactions": {"percent_remaining": 90,
                                                          "remaining": None, "entitlement": 300}}}
        self.assertEqual(c.janelas_copilot(q)[0]["detalhe"], "0 de 300 restantes")

    def test_agy_periodos(self):
        js = {j["id"]: j["periodo"] for j in c.janelas_agy(AGY)}
        self.assertEqual(js, {"gemini-weekly": "S", "gemini-5h": "H", "gemini-argon-wtu-weekly": "S"})


class Coleta(unittest.TestCase):
    def test_saida_nunca_tem_token(self):
        with tempfile.TemporaryDirectory() as home:
            os.makedirs(os.path.join(home, ".claude"))
            with open(os.path.join(home, ".claude", ".credentials.json"), "w") as fh:
                json.dump({"claudeAiOauth": {"accessToken": "SEGREDO-123", "subscriptionType": "pro"}}, fh)
            with mock.patch.object(c, "http_json", return_value=CLAUDE):
                dados = c.coletar(["claude"], home, None)
            self.assertNotIn("SEGREDO", json.dumps(dados))
            self.assertEqual(dados["provedores"][0]["estado"], "ok")

    def test_ausente_e_erro_nao_derrubam_os_outros(self):
        with tempfile.TemporaryDirectory() as home:
            def quebra(_):
                raise RuntimeError("bug")
            with mock.patch.dict(c.PROVEDORES, {"claude": ("Claude", quebra)}):
                dados = c.coletar(["claude", "codex"], home, None)
        estados = {p["id"]: p["estado"] for p in dados["provedores"]}
        self.assertEqual(estados, {"claude": "erro", "codex": "ausente"})

    def test_token_vencido_mantem_leitura_e_zera_o_que_reiniciou(self):
        passado = c.iso(c.agora() - dt.timedelta(hours=1))
        futuro = c.iso(c.agora() + dt.timedelta(days=2))
        velho_ok = c.iso(c.agora() - dt.timedelta(days=1))
        anterior = {"provedores": [{"id": "agy", "lido_em_ok": velho_ok, "janelas": [
            {"id": "5h", "tipo": "curta", "usado": 40, "reinicia": passado},
            {"id": "sem", "tipo": "longa", "usado": 60, "reinicia": futuro}]}]}

        def vencido(_):
            raise c.Falha("token vencido", False)
        with mock.patch.dict(c.PROVEDORES, {"agy": ("Antigravity", vencido)}):
            dados = c.coletar(["agy"], "/nao/existe", anterior)
        p = dados["provedores"][0]
        self.assertTrue(p["desatualizado"])
        usado = {j["id"]: j["usado"] for j in p["janelas"]}
        self.assertEqual(usado, {"5h": 0.0, "sem": 60})

    def test_reserva_corrompida_nao_derruba(self):
        with tempfile.TemporaryDirectory() as home:
            os.makedirs(os.path.join(home, ".cache", "agy-skill"))
            with open(os.path.join(home, ".cache", "agy-skill", "cota.json"), "w") as fh:
                fh.write("{quebrado")

            def falha(_):
                raise c.Falha("sem conexão")
            with mock.patch.dict(c.PROVEDORES, {"claude": ("Claude", falha)}):
                dados = c.coletar(["claude", "codex"], home, None)
        self.assertEqual([p["estado"] for p in dados["provedores"]], ["erro", "ausente"])

    def test_gravar_e_legivel_e_atomico(self):
        with tempfile.TemporaryDirectory() as pasta:
            arq = os.path.join(pasta, "x.json")
            c.gravar(arq, {"a": 1})
            self.assertEqual(oct(os.stat(arq).st_mode & 0o777), "0o644")
            self.assertEqual(os.listdir(pasta), ["x.json"])


if __name__ == "__main__":
    unittest.main()
