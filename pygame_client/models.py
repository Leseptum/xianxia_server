from dataclasses import dataclass
from enum import IntEnum


class Biom(IntEnum):
    WASSER = 0
    STRAND = 1
    EBENE = 2
    WALD = 3
    BERG = 4
    SCHNEE = 5


BIOM_FARBEN = {
    Biom.WASSER: (40, 90, 200),
    Biom.STRAND: (230, 210, 150),
    Biom.EBENE: (140, 200, 90),
    Biom.WALD: (40, 110, 50),
    Biom.BERG: (120, 120, 125),
    Biom.SCHNEE: (240, 240, 245),
}


@dataclass
class PlayerRow:
    player_id: int
    name: str
    password_hash: str
    qi: int
    qi_maximum: int
    stufe: int
    pos_x: float
    pos_y: float

    @staticmethod
    def from_dict(d):
        return PlayerRow(
            player_id=int(d["player_id"]),
            name=d["name"],
            password_hash=d["password_hash"],
            qi=int(d["qi"]),
            qi_maximum=int(d["qi_maximum"]),
            stufe=int(d["stufe"]),
            pos_x=float(d["pos_x"]),
            pos_y=float(d["pos_y"]),
        )
