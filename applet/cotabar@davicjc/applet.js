// CotaBar — applet do Cinnamon que mostra quanto da cota de cada IA já foi usado.
// Só lê os JSON gerados pelo cotabar-coletor; nunca vê token.

const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const ByteArray = imports.byteArray;

const PASTA_USUARIO = GLib.build_filenamev([GLib.get_user_cache_dir(), "cotabar"]);
const PASTAS_FONTES = [PASTA_USUARIO, "/var/lib/cotabar"];
const COLETOR_SISTEMA = "/usr/local/bin/cotabar-coletor";

// Cor de cada IA (anel) e letra no meio.
const MARCA = {
    claude:  { cor: [0.85, 0.47, 0.34], letra: "C" },
    agy:     { cor: [0.30, 0.55, 0.96], letra: "A" },
    codex:   { cor: [0.20, 0.72, 0.56], letra: "X" },
    copilot: { cor: [0.62, 0.48, 0.92], letra: "P" },
};
const ORDEM = ["claude", "agy", "codex", "copilot"];
const PESO_ESTADO = { ok: 3, erro: 1, ausente: 0 };

function lerTexto(caminho) {
    try {
        const [ok, raw] = GLib.file_get_contents(caminho);
        if (!ok) return null;
        return typeof raw === "string" ? raw : ByteArray.toString(raw);
    } catch (e) {
        return null;
    }
}

function listarJson(pasta) {
    const out = [];
    try {
        const dir = Gio.File.new_for_path(pasta);
        const en = dir.enumerate_children("standard::name,standard::type", Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null)) !== null) {
            const nome = info.get_name();
            if (nome.endsWith(".json") && !nome.startsWith(".")) out.push(GLib.build_filenamev([pasta, nome]));
        }
        en.close(null);
    } catch (e) { /* pasta ainda não existe */ }
    return out;
}

function tempo(iso) {
    const t = iso ? Date.parse(iso) : NaN;
    return isNaN(t) ? 0 : t;
}

// Junta os provedores de todos os arquivos: vence quem tem leitura boa, depois o mais novo.
function juntar() {
    const melhor = {};
    for (const pasta of PASTAS_FONTES) {
        for (const arq of listarJson(pasta)) {
            let dados;
            try { dados = JSON.parse(lerTexto(arq) || "null"); } catch (e) { continue; }
            if (!dados || !Array.isArray(dados.provedores)) continue;
            for (const p of dados.provedores) {
                const atual = melhor[p.id];
                const peso = (PESO_ESTADO[p.estado] || 0) + (p.janelas && p.janelas.length ? 1 : 0);
                const pesoAtual = atual ? (PESO_ESTADO[atual.estado] || 0) + (atual.janelas && atual.janelas.length ? 1 : 0) : -1;
                if (peso > pesoAtual || (peso === pesoAtual && tempo(p.lido_em) > tempo(atual.lido_em))) {
                    melhor[p.id] = p;
                }
            }
        }
    }
    return ORDEM.filter(id => melhor[id]).map(id => melhor[id])
        .concat(Object.keys(melhor).filter(id => ORDEM.indexOf(id) < 0).map(id => melhor[id]));
}

function maior(janelas, tipo) {
    let m = null;
    for (const j of janelas || []) {
        if (j.tipo === tipo && (m === null || j.usado > m)) m = j.usado;
    }
    return m;
}

// Item de menu só de leitura, sem o cinza de "desativado" que o Cinnamon põe.
function itemFixo() {
    const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
    item.actor.remove_style_pseudo_class("insensitive");
    return item;
}

const PLANOS = { free_educational_quota: "educacional", free_limited_copilot: "grátis", consumer: "pessoal" };

function fmtPlano(plano) {
    if (!plano) return "";
    const s = String(plano);
    if (PLANOS[s]) return PLANOS[s];
    return s.replace(/_quota$/, "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
}

function fmtPct(v) {
    return v === null || v === undefined ? "–" : Math.round(v) + "%";
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function fmtReinicio(iso) {
    const t = tempo(iso);
    if (!t) return "";
    const agora = Date.now();
    let s = Math.max(0, Math.round((t - agora) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    const falta = d > 0 ? `${d} d ${h} h` : (h > 0 ? `${h} h ${m} min` : `${m} min`);
    const dt = new Date(t);
    const hora = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
    const hoje = new Date(agora).toDateString() === dt.toDateString();
    const quando = hoje ? hora : (d >= 6 ? `${dt.getDate()}/${dt.getMonth() + 1}` : `${DIAS[dt.getDay()]} ${hora}`);
    return `em ${falta} · ${quando}`;
}

function fmtHaQuanto(iso) {
    const t = tempo(iso);
    if (!t) return "nunca";
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

function classeNivel(v) {
    if (v === null || v === undefined) return "";
    if (v >= 95) return " cotabar-critico";
    if (v >= 80) return " cotabar-alto";
    return "";
}

// Anel duplo: de fora = janela longa (semana/mês), de dentro = curta (5 h/dia).
class Anel {
    constructor(id, tamanho) {
        this.id = id;
        this.longa = null;
        this.curta = null;
        this.apagado = false;
        const marca = MARCA[id] || { cor: [0.7, 0.7, 0.7], letra: id.charAt(0).toUpperCase() };
        this.cor = marca.cor;

        this.actor = new St.Widget({ layout_manager: new Clutter.BinLayout(), style_class: "cotabar-anel" });
        this.area = new St.DrawingArea({ width: tamanho, height: tamanho });
        this.area.connect("repaint", (a) => this._pintar(a));
        this.letra = new St.Label({ text: marca.letra, style_class: "cotabar-letra",
                                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        this.actor.add_child(this.area);
        this.actor.add_child(this.letra);
    }

    definir(curta, longa, apagado) {
        this.curta = curta;
        this.longa = longa;
        this.apagado = apagado;
        this.letra.opacity = apagado ? 110 : 255;
        this.area.queue_repaint();
    }

    _pintar(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const fg = this.letra.get_theme_node().get_foreground_color();
        const cx = w / 2, cy = h / 2;
        const esp = Math.max(2, Math.round(w / 10));
        const rFora = Math.min(w, h) / 2 - esp / 2 - 0.5;
        const rDentro = rFora - esp - 1.5;
        const inicio = -Math.PI / 2;
        const [r, g, b] = this.cor;
        const alfa = this.apagado ? 0.45 : 1;

        cr.setLineWidth(esp);
        cr.setLineCap(1); // redondo

        for (const [raio, valor] of [[rFora, this.longa], [rDentro, this.curta]]) {
            cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, 0.16);
            cr.arc(cx, cy, raio, 0, 2 * Math.PI);
            cr.stroke();
            if (valor !== null && valor > 0) {
                cr.setSourceRGBA(r, g, b, alfa * (raio === rFora ? 1 : 0.8));
                cr.arc(cx, cy, raio, inicio, inicio + 2 * Math.PI * Math.min(1, valor / 100));
                cr.stroke();
            }
        }
        cr.$dispose();
    }
}

class CotaBarApplet extends Applet.Applet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);
        this.metadata = metadata;
        this.orientation = orientation;
        this.provedores = [];
        this.aneis = {};
        this.rodando = false;

        this.settings = new Settings.AppletSettings(this, metadata.uuid, instanceId);
        this.settings.bind("coletar", "coletar", () => this._reagendar(true));
        this.settings.bind("provedores", "listaProvedores", () => this._reagendar(true));
        this.settings.bind("intervalo", "intervalo", () => this._reagendar(false));
        this.settings.bind("mostrar", "mostrar", () => this._desenhar());
        this.settings.bind("ocultar-ausentes", "ocultarAusentes", () => this._desenhar());

        const vertical = orientation === St.Side.LEFT || orientation === St.Side.RIGHT;
        this.caixa = new St.BoxLayout({ vertical, style_class: "cotabar-caixa" });
        this.actor.add_child(this.caixa);
        this.set_applet_tooltip("CotaBar — uso das cotas de IA");

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this.menu.connect("open-state-changed", (m, aberto) => { if (aberto) this._montarMenu(); });

        this._tamanho = Math.max(16, Math.min(28, panelHeight - 9));
        this._ler();
        this._reagendar(true);
        this._loopLeitura = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, 30, () => {
            this._ler();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // ------------------------------------------------------------ coleta

    _caminhoColetor() {
        if (GLib.file_test(COLETOR_SISTEMA, GLib.FileTest.IS_EXECUTABLE)) return COLETOR_SISTEMA;
        return GLib.build_filenamev([this.metadata.path, "cotabar-coletor"]);
    }

    _reagendar(agora) {
        if (this._loopColeta) {
            GLib.source_remove(this._loopColeta);
            this._loopColeta = null;
        }
        const seg = Math.max(2, this.intervalo || 5) * 60;
        this._loopColeta = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, seg, () => {
            this._coletar();
            return GLib.SOURCE_CONTINUE;
        });
        if (agora) this._coletar();
    }

    _coletar() {
        if (!this.coletar || this.rodando) return;
        const lista = (this.listaProvedores || "").replace(/\s+/g, "");
        if (!lista) return;
        GLib.mkdir_with_parents(PASTA_USUARIO, 0o755);
        const argv = ["python3", "-I", this._caminhoColetor(),
                      "--saida", GLib.build_filenamev([PASTA_USUARIO, "usuario.json"]),
                      "--provedores", lista];
        try {
            const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE);
            this.rodando = true;
            proc.communicate_utf8_async(null, null, (p, res) => {
                this.rodando = false;
                if (this._removido) return;
                try {
                    const [, , err] = p.communicate_utf8_finish(res);
                    if (!p.get_successful() && err) global.logError("CotaBar: " + err.trim());
                } catch (e) {
                    global.logError("CotaBar: " + e.message);
                }
                this._ler();
            });
        } catch (e) {
            this.rodando = false;
            global.logError("CotaBar: não consegui rodar o coletor: " + e.message);
        }
    }

    _atualizarTudo() {
        // O serviço root (se houver) roda no timer dele; aqui coleta o do usuário e relê tudo.
        this._coletar();
        this._ler();
    }

    // ------------------------------------------------------------ barra

    _ler() {
        this.provedores = juntar();
        this._desenhar();
        if (this.menu.isOpen) this._montarMenu();
    }

    _visiveis() {
        return this.provedores.filter(p => !(this.ocultarAusentes && p.estado === "ausente"));
    }

    _desenhar() {
        const vis = this._visiveis();
        const ids = vis.map(p => p.id).join(",");
        if (ids !== this._ids) {
            this.caixa.destroy_all_children();
            this._vazio = null;
            this.aneis = {};
            this.textos = {};
            for (const p of vis) {
                const item = new St.BoxLayout({ style_class: "cotabar-item" });
                const anel = new Anel(p.id, this._tamanho);
                const texto = new St.Label({ style_class: "cotabar-numeros", y_align: Clutter.ActorAlign.CENTER });
                item.add_child(anel.actor);
                item.add_child(texto);
                this.caixa.add_child(item);
                this.aneis[p.id] = anel;
                this.textos[p.id] = texto;
            }
            this._ids = ids;
        }
        if (!vis.length) {
            if (!this._vazio) {
                this._vazio = new St.Label({ text: "IA –", style_class: "cotabar-numeros", y_align: Clutter.ActorAlign.CENTER });
                this.caixa.add_child(this._vazio);
            }
        } else if (this._vazio) {
            this._vazio.destroy();
            this._vazio = null;
        }

        const dicas = [];
        for (const p of vis) {
            const curta = maior(p.janelas, "curta");
            const longa = maior(p.janelas, "longa");
            const apagado = p.estado !== "ok";
            this.aneis[p.id].definir(curta, longa, apagado);
            const t = this.textos[p.id];
            let linhas;
            if (this.mostrar === "curta") linhas = [fmtPct(curta !== null ? curta : longa)];
            else if (this.mostrar === "longa") linhas = [fmtPct(longa !== null ? longa : curta)];
            else if (this.mostrar === "nada") linhas = [];
            else linhas = curta !== null && longa !== null ? [fmtPct(curta), fmtPct(longa)] : [fmtPct(curta !== null ? curta : longa)];
            t.visible = linhas.length > 0;
            t.set_text(linhas.join("\n"));
            const topo = Math.max(curta || 0, longa || 0);
            t.style_class = "cotabar-numeros" + (linhas.length > 1 ? " cotabar-duas" : "") + classeNivel(topo) + (apagado ? " cotabar-apagado" : "");
            dicas.push(`${p.nome}: ${curta !== null ? "curta " + fmtPct(curta) : ""}${curta !== null && longa !== null ? " · " : ""}${longa !== null ? "longa " + fmtPct(longa) : ""}${p.estado === "erro" ? " (" + (p.erro || "erro") + ")" : ""}`);
        }
        this.set_applet_tooltip(dicas.length ? dicas.join("\n") + "\nAnel de fora: semana/mês · de dentro: 5 h/dia" : "CotaBar — nenhum dado ainda");
    }

    // ------------------------------------------------------------ menu

    _montarMenu() {
        this.menu.removeAll();
        const vis = this._visiveis();
        if (!vis.length) {
            this.menu.addMenuItem(this._linhaTexto("Nenhuma leitura ainda. Confira se o cotabar-coletor está instalado.", "cotabar-aviso"));
        }
        vis.forEach((p, i) => {
            if (i > 0) this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(this._cabecalho(p));
            if (p.estado === "ausente") {
                this.menu.addMenuItem(this._linhaTexto("Não encontrado nesta máquina", "cotabar-aviso"));
                return;
            }
            if (p.erro) {
                this.menu.addMenuItem(this._linhaTexto((p.desatualizado ? "Última leitura boa " + fmtHaQuanto(p.lido_em_ok) + " — " : "") + p.erro, "cotabar-aviso"));
            }
            const ordenadas = (p.janelas || []).slice().sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "curta" ? -1 : 1));
            for (const j of ordenadas) this.menu.addMenuItem(this._linhaJanela(p, j));
        });
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const atualizar = new PopupMenu.PopupIconMenuItem("Atualizar agora", "view-refresh-symbolic", St.IconType.SYMBOLIC);
        atualizar.connect("activate", () => this._atualizarTudo());
        this.menu.addMenuItem(atualizar);
    }

    _cabecalho(p) {
        const item = itemFixo();
        const caixa = new St.BoxLayout({ style_class: "cotabar-cab", x_expand: true });
        const cor = (MARCA[p.id] || { cor: [0.7, 0.7, 0.7] }).cor.map(c => Math.round(c * 255)).join(",");
        caixa.add_child(new St.Widget({ style_class: "cotabar-ponto", style: `background-color: rgb(${cor});`, y_align: Clutter.ActorAlign.CENTER }));
        caixa.add_child(new St.Label({ text: p.nome, style_class: "cotabar-nome", y_align: Clutter.ActorAlign.CENTER }));
        if (p.plano) caixa.add_child(new St.Label({ text: fmtPlano(p.plano), style_class: "cotabar-plano", y_align: Clutter.ActorAlign.CENTER }));
        caixa.add_child(new St.Widget({ x_expand: true }));
        caixa.add_child(new St.Label({ text: fmtHaQuanto(p.lido_em_ok || p.lido_em), style_class: "cotabar-quando", y_align: Clutter.ActorAlign.CENTER }));
        item.addActor(caixa, { expand: true, span: -1 });
        return item;
    }

    _linhaTexto(texto, classe) {
        const item = itemFixo();
        item.addActor(new St.Label({ text: texto, style_class: classe }), { expand: true, span: -1 });
        return item;
    }

    _linhaJanela(p, j) {
        const item = itemFixo();
        const linha = new St.BoxLayout({ vertical: true, style_class: "cotabar-janela", x_expand: true });

        const topo = new St.BoxLayout({ x_expand: true });
        topo.add_child(new St.Label({ text: j.rotulo, style_class: "cotabar-rotulo" }));
        topo.add_child(new St.Widget({ x_expand: true }));
        topo.add_child(new St.Label({ text: fmtPct(j.usado), style_class: "cotabar-pct" + classeNivel(j.usado) }));
        linha.add_child(topo);

        const LARGURA = 260;
        const trilho = new St.Widget({ style_class: "cotabar-trilho", width: LARGURA });
        const cor = (MARCA[p.id] || { cor: [0.7, 0.7, 0.7] }).cor.map(c => Math.round(c * 255)).join(",");
        const fim = Math.max(0, Math.min(1, j.usado / 100));
        if (fim > 0) {
            trilho.add_child(new St.Widget({ style_class: "cotabar-cheio",
                                             style: `background-color: rgb(${cor});`,
                                             width: Math.max(4, Math.round(LARGURA * fim)) }));
        }
        linha.add_child(trilho);

        const pe = [j.detalhe, j.reinicia ? "reinicia " + fmtReinicio(j.reinicia) : null].filter(Boolean).join(" · ");
        if (pe) linha.add_child(new St.Label({ text: pe, style_class: "cotabar-pe" }));
        item.addActor(linha, { expand: true, span: -1 });
        return item;
    }

    on_applet_clicked() {
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
        this._removido = true;
        for (const k of ["_loopColeta", "_loopLeitura"]) {
            if (this[k]) {
                GLib.source_remove(this[k]);
                this[k] = null;
            }
        }
        this.settings.finalize();
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new CotaBarApplet(metadata, orientation, panelHeight, instanceId);
}
