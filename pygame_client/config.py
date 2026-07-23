import os

SERVER_URL = os.environ.get("XIANXIA_SERVER_URL", "http://127.0.0.1:3000")
DATABASE_NAME = os.environ.get("XIANXIA_DB_NAME", "xianxia")

IDENTITY_FILE = os.path.join(os.path.dirname(__file__), ".stdb_identity.json")

TILE_SIZE = 24
POLL_INTERVAL_SECONDS = 0.4
MOVE_UPDATE_INTERVAL_SECONDS = 0.15
PLAYER_SPEED = 40.0  # world units per second
WORLD_SIZE = 256
