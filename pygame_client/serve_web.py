#!/usr/bin/env python3
"""Start the Xianxia web client and serve it over HTTP.

Just run:

    python3 serve_web.py

This builds the pygame client to WebAssembly with pygbag and serves it on
port 64646 (override with the XIANXIA_WEB_PORT env var), reachable from other
devices on your LAN. Open the printed URL in a browser.

We wrap pygbag's own serve mode on purpose: its test server sends the
cross-origin headers (COOP/COEP/CORP) that the WASM runtime needs. Re-hosting
the built files under a hand-rolled server would have to replicate those
headers exactly, which is brittle across pygbag versions.

Note: this serves the *interface*. The game data still comes straight from
SpacetimeDB, which the browser fetches directly - so that endpoint must allow
CORS (Maincloud does; a bare local `spacetime start` may not). See README.
"""

import os
import socket
import subprocess
import sys
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
MAIN = HERE / "main.py"
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


def main():
    try:
        import pygbag  # noqa: F401
    except ImportError:
        print("pygbag ist nicht installiert. Installiere es mit:\n\n    pip install pygbag\n")
        return 1

    if not MAIN.exists():
        print(f"main.py nicht gefunden unter {MAIN}")
        return 1

    print("Baue und serviere den Web-Client (das erste Mal dauert es etwas)...")
    print(f"  Lokal:   http://localhost:{PORT}/")
    ip = _lan_ip()
    if ip:
        print(f"  Im LAN:  http://{ip}:{PORT}/   (z.B. vom Handy im selben Netz)")
    print("  Beenden mit Strg+C\n")

    cmd = [
        sys.executable, "-m", "pygbag",
        "--bind", "0.0.0.0",
        "--port", str(PORT),
        str(MAIN),
    ]
    try:
        return subprocess.run(cmd).returncode
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
