#!/usr/bin/env python3
"""Start the Xianxia web client and serve it over HTTP.

Just run:

    python3 serve_web.py

This builds the pygame client to WebAssembly with pygbag and serves it on
port 64646 (override with XIANXIA_WEB_PORT). Open the printed URL in a browser.

We bind to the machine's LAN IP (override with XIANXIA_WEB_HOST), NOT 0.0.0.0.
pygbag bakes the bind address literally into the runtime's asset URLs
(pygbag/app.py: proxy = f"http://{bind}:{port}/"), so binding to 0.0.0.0 makes
the browser try to load http://0.0.0.0:PORT/...pythons.js, which it rejects as
an invalid/foreign origin -> the loader hangs forever on "Downloading...".
Binding to the concrete host the browser actually uses fixes that. The flip
side: only that one host works, so localhost:PORT won't serve when bound to the
LAN IP (use XIANXIA_WEB_HOST=localhost for same-machine-only access).

We wrap pygbag's own serve mode on purpose: its test server sends the
cross-origin headers (COOP/COEP/CORP) that the WASM runtime needs. Re-hosting
the built files under a hand-rolled server would have to replicate those
headers exactly, which is brittle across pygbag versions.

Note: this serves the *interface*. The game data still comes straight from
SpacetimeDB, which the browser fetches directly - so that endpoint must allow
CORS (Maincloud does; a bare local `spacetime start` may not). See README.
"""

import os
import re
import socket
import subprocess
import sys
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
MAIN = HERE / "main.py"
CONFIG = HERE / "config.py"
PORT = int(os.environ.get("XIANXIA_WEB_PORT", "64646"))


def _lan_ip():
    """Best-effort local IP for the LAN URL hint (no traffic actually sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def _sync_default_server_url(host):
    """Keep config.py's baked-in default server in sync with the host we're
    actually binding to (assumes SpacetimeDB runs on the same machine, port
    3000 - true for this local dev setup). Without this, a stale hardcoded IP
    in config.py (e.g. after a DHCP lease change) makes the client silently
    try the wrong address and fail with a generic fetch error indistinguishable
    from a real CORS/network problem."""
    if not CONFIG.exists():
        return
    text = CONFIG.read_text()
    new_default = f'_DEFAULT_URL = "http://{host}:3000"'
    updated, count = re.subn(r'_DEFAULT_URL = "[^"]*"', new_default, text, count=1)
    if count and updated != text:
        CONFIG.write_text(updated)
        print(f"  config.py Default-Server aktualisiert auf http://{host}:3000")


def main():
    try:
        import pygbag  # noqa: F401
    except ImportError:
        print("pygbag ist nicht installiert. Installiere es mit:\n\n    pip install pygbag\n")
        return 1

    if not MAIN.exists():
        print(f"main.py nicht gefunden unter {MAIN}")
        return 1

    host = os.environ.get("XIANXIA_WEB_HOST") or _lan_ip() or "localhost"
    _sync_default_server_url(host)

    print("Baue und serviere den Web-Client (das erste Mal dauert es etwas)...")
    print(f"  Genau diese URL im Browser oeffnen (auch auf diesem Rechner):")
    print(f"      http://{host}:{PORT}/")
    if host == "localhost":
        print("  Hinweis: nur auf diesem Rechner erreichbar (keine LAN-IP ermittelt).")
        print("  Fuer LAN/Handy: XIANXIA_WEB_HOST=<deine-IP> python3 serve_web.py")
    else:
        print(f"  (Vom Handy im selben Netz: dieselbe URL. 'localhost:{PORT}' geht dann NICHT.)")
    print("  Beenden mit Strg+C\n")

    cmd = [
        sys.executable, "-m", "pygbag",
        "--bind", host,
        "--port", str(PORT),
        str(MAIN),
    ]
    try:
        return subprocess.run(cmd).returncode
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
