# Server/db are picked via URL query params, e.g.
#   index.html?server=https://maincloud.spacetimedb.com&db=xianxia
# Defaults to our local SpacetimeDB server + the "xianxia" database when no
# params are given (xianxia isn't published on Maincloud - local-only for now).
# NOTE: this is the game server's current LAN IP; update if it changes.
_DEFAULT_URL = "http://192.168.178.65:3000"
_DEFAULT_DB = "xianxia"


def _web_query_params():
    try:
        import platform  # pygbag-provided
        import urllib.parse

        search = str(platform.window.location.search or "")
        return urllib.parse.parse_qs(search.lstrip("?"))
    except Exception:
        return {}


_params = _web_query_params()
SERVER_URL = _params.get("server", [_DEFAULT_URL])[0]
DATABASE_NAME = _params.get("db", [_DEFAULT_DB])[0]

TILE_SIZE = 24
POLL_INTERVAL_SECONDS = 0.4
MOVE_UPDATE_INTERVAL_SECONDS = 0.15
PLAYER_SPEED = 40.0  # world units per second
WORLD_SIZE = 256
