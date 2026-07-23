import os

import config
from models import Biom

BYTES_PER_TILE = 5  # biom, kraeuter, spirit_stones, holz, erz


class WorldGrid:
    def __init__(self, breite, hoehe, data):
        self.breite = breite
        self.hoehe = hoehe
        self.data = data  # bytes, BYTES_PER_TILE per tile, indexed by x + y*breite

    def get_tile(self, x, y):
        if x < 0 or y < 0 or x >= self.breite or y >= self.hoehe:
            return None
        offset = (x + y * self.breite) * BYTES_PER_TILE
        chunk = self.data[offset:offset + BYTES_PER_TILE]
        return {
            "biom": Biom(chunk[0]),
            "kraeuter": chunk[1],
            "spirit_stones": chunk[2],
            "holz": chunk[3],
            "erz": chunk[4],
        }


def _cache_path(seed):
    return os.path.join(os.path.dirname(__file__), f"world_cache_seed{seed}.bin")


def load_world(client):
    meta_rows = client.sql("SELECT * FROM world_meta")
    if not meta_rows:
        raise RuntimeError("world_meta ist leer - wurde die Welt bereits generiert (Init-Reducer gelaufen)?")

    meta = meta_rows[0]
    seed = int(meta["seed"])
    breite = int(meta["breite"])
    hoehe = int(meta["hoehe"])

    cache_path = _cache_path(seed)
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            data = f.read()
        if len(data) == breite * hoehe * BYTES_PER_TILE:
            return WorldGrid(breite, hoehe, data)

    tiles = client.sql("SELECT * FROM world_tile")
    buf = bytearray(breite * hoehe * BYTES_PER_TILE)
    for tile in tiles:
        x = int(tile["x"])
        y = int(tile["y"])
        offset = (x + y * breite) * BYTES_PER_TILE
        buf[offset] = int(tile["biom_typ"]) & 0xFF
        buf[offset + 1] = int(tile["kraeuter_menge"]) & 0xFF
        buf[offset + 2] = int(tile["spirit_stones"]) & 0xFF
        buf[offset + 3] = int(tile["holz"]) & 0xFF
        buf[offset + 4] = int(tile["erz"]) & 0xFF

    data = bytes(buf)
    with open(cache_path, "wb") as f:
        f.write(data)

    return WorldGrid(breite, hoehe, data)
