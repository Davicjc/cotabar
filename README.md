# CotaBar

**English** · [Português](README.pt-BR.md) · [Español](README.es.md)

**Know how much of your AI coding limits you've burned — without leaving your desktop.**
CotaBar is a Linux Mint / **Cinnamon** panel applet that shows the usage of
**Claude Code**, **Codex (ChatGPT)**, **Antigravity (Gemini)** and **GitHub Copilot**:
the short window (5 hours / day) and the long one (week / month), side by side.

![CotaBar on the Cinnamon panel](docs/panel.png)

[![tests](https://github.com/Davicjc/cotabar/actions/workflows/testes.yml/badge.svg)](https://github.com/Davicjc/cotabar/actions/workflows/testes.yml)
![Cinnamon](https://img.shields.io/badge/Cinnamon-6.x-87a556)
![Python](https://img.shields.io/badge/python-3.10%2B%20stdlib%20only-3776ab)
![License](https://img.shields.io/badge/license-MIT-green)

No more hitting "you've reached your limit" in the middle of a task. One glance at the
panel tells you whether to keep going, switch tools, or wait for the reset.

## What you see

Each AI is a double ring with its letter in the middle:

- **outer ring** — long window (week or month)
- **inner ring** — short window (5 hours or day)
- next to it, both percentages with the period letter: **H** hours, **D** day,
  **W** week, **M** month (e.g. `84% H` / `61% W`). They turn amber at 80% and red at 95%.

Click it for every limit, with a bar, the percentage and when it resets
("resets in 4 h 47 min · 13:10").

The interface speaks **English, Spanish and Portuguese** (automatic, or pick one in the settings).

## Supported tools

| AI | Letter | Where it reads from | Windows |
|---|---|---|---|
| **Claude Code** | C | `~/.claude/.credentials.json` → `api.anthropic.com/api/oauth/usage` (same as `/usage`) | 5-hour session, week, week per model, monthly extra usage |
| **Antigravity** (`agy`) | A | `~/.gemini/antigravity-cli/antigravity-oauth-token` → Cloud Code `retrieveUserQuotaSummary` | 5 h and week per model group (Gemini, Claude/GPT, Argon) |
| **Codex** (ChatGPT) | X | `~/.codex/auth.json` → `chatgpt.com/backend-api/wham/usage` | 5 h and week (or credits) |
| **GitHub Copilot** | P | `gh auth token` → `api.github.com/copilot_internal/user` | monthly premium requests / chat |

Tools that are not installed stay hidden (you can show them in the settings).

## Safe by design

- **Never refreshes a token.** Refreshing Claude's or Codex's token rotates it and would
  log out the running tool. If a token has expired, CotaBar says so and keeps the last good
  reading — with an expired token the tool is idle, so usage didn't go up; it only zeroes
  the windows that have already reset.
- **Never writes a token.** The output JSON holds percentages, labels and times only.
- **No new login, no extra account.** It borrows the session each tool already has.
- One failing provider never takes the others down; a network error keeps the previous
  reading for up to 6 hours.
- Python 3 standard library only. No pip, no dependencies.

## Install

```bash
git clone https://github.com/Davicjc/cotabar.git
cd cotabar
./instalar.sh                # applet + collector for your user
sudo ./instalar.sh --root    # also a timer for AIs signed in as root (e.g. `sudo claude`)
```

The applet shows up on the panel right away — no Cinnamon restart.
Uninstall: `./instalar.sh --remove` (with `sudo` if you used `--root`).

Requirements: Cinnamon (tested on 6.6 / Linux Mint 22) and Python 3.10+.

### Settings

Right-click the applet → **Configure**. Everything is a switch or a list:

| Tab | Option | Default |
|---|---|---|
| AIs | Claude Code / Antigravity / Codex / GitHub Copilot (one switch each) | on |
| AIs | Hide the ones that are not installed | on |
| AIs | Read the AIs signed in on this user | on |
| AIs | Check every | 5 min |
| Panel | Numbers next to the ring (short and long / short / long / rings only) | short and long |
| Panel | Period letter after the % | on |
| Panel | Language (automatic / English / Español / Português) | automatic |

## How it works

```
cotabar-coletor (Python)  ──►  ~/.cache/cotabar/usuario.json  ─┐
  run by the applet every N min                                ├─►  applet (GJS) draws
cotabar-root.timer (systemd)  ──►  /var/lib/cotabar/root.json  ─┘
  optional, for AIs signed in as root
```

The applet merges both folders; if the same AI shows up twice, the most recent good
reading wins. The root timer runs with `ProtectSystem=strict` and `ProtectHome=read-only`
and only writes to `/var/lib/cotabar`.

Run the collector by hand:

```bash
cotabar-coletor --print                     # everything, just print
cotabar-coletor --providers claude,agy      # only some
```

## Contributing

Issues and pull requests are welcome — especially **new providers** (Cursor, Gemini CLI,
Kimi, Grok…) and **translations**. Translations of the settings window live in
[`applet/cotabar@davicjc/po/`](applet/cotabar@davicjc/po/) (copy the `.pot`); the panel and
menu strings are in the `TEXTOS` table at the top of `applet.js`.

```bash
python3 -m unittest discover -s tests -v
```

## Credits

Inspired by [Codenotch](https://github.com/vinzdg/codenotch) (macOS/Windows), which pins these
limits to a notch on the screen edge. CotaBar is a separate implementation, written from
scratch for the Cinnamon panel — no code was copied.

## License

MIT — see [LICENSE](LICENSE).

---

Made by [Davi Castro](https://davicjc.com) · *cota* is Portuguese for "quota".
