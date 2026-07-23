import os

import http_backend

# Defaults differ by platform:
#  - Desktop: talk to a local `spacetime start` by default; override via env vars.
#  - Web (pygbag): localhost is the user's phone/browser, not the server, and a
#    browser can't reach a plain-HTTP local server anyway (CORS), so default to
#    Maincloud. Override at runtime with URL query params, e.g.
#    index.html?server=https://maincloud.spacetimedb.com&db=xianxia
_DEFAULT_DESKTOP_URL = "http://127.0.0.1:3000"
_DEFAULT_WEB_URL = "https://maincloud.spacetimedb.com"
_DEFAULT_DB = "xianxia"


def _web_query_params():
    try:
        import platform  # pygbag-provided
        import urllib.parse

        search = str(platform.window.location.search or "")
        return urllib.parse.parse_qs(search.lstrip("?"))
    except Exception:
        return {}


if http_backend.IS_WEB:
    _params = _web_query_params()
    SERVER_URL = _params.get("server", [_DEFAULT_WEB_URL])[0]
    DATABASE_NAME = _params.get("db", [_DEFAULT_DB])[0]
else:
    SERVER_URL = os.environ.get("XIANXIA_SERVER_URL", _DEFAULT_DESKTOP_URL)
    DATABASE_NAME = os.environ.get("XIANXIA_DB_NAME", _DEFAULT_DB)

IDENTITY_FILE = os.path.join(os.path.dirname(__file__), ".stdb_identity.json")

TILE_SIZE = 24
POLL_INTERVAL_SECONDS = 0.4
MOVE_UPDATE_INTERVAL_SECONDS = 0.15
PLAYER_SPEED = 40.0  # world units per second
WORLD_SIZE = 256
