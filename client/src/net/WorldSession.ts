import type { DbConnection } from "../module_bindings";
import type { Npc as NpcRow, Player as PlayerRow, WorldTile as WorldTileRow } from "../module_bindings/types";
import type { WorldGrid } from "../world";
import type { Point } from "../logic/projection";
import { isWalkableBiom, PredictedPosition, type Direction } from "../logic/movement";
import { nearestInRange } from "../logic/combat";
import { Emitter } from "./emitter";
import { errorMessage } from "./errors";

export type NoticeKind = "info" | "success" | "warning" | "error";

export interface WorldSessionEvents {
  /** Insert oder Update einer Spielerzeile auf DIESER Karte (inkl. eigener Spieler). */
  playerChanged: [PlayerRow];
  playerRemoved: [bigint];
  npcChanged: [NpcRow];
  npcRemoved: [bigint];
  /** Kachel wurde (Karteneditor) geändert; worldGrid ist bereits aktualisiert. */
  tileChanged: [number, number];
  /** Vorhergesagte eigene Position hat sich geändert - eigener Schritt (false) oder Korrektur durch den Server (true). */
  localMoved: [Point, boolean];
  notice: [string, NoticeKind];
}

/**
 * Live-Zustand der Karte, auf der der eingeloggte Spieler steht, plus alle Spiel-Aktionen
 * (Reducer-Aufrufe). Phaser-frei - WorldScene/HudScene hören nur auf `events` und lesen die
 * Maps; sie fassen das SDK nie direkt an.
 *
 * players/npcs sind auf die eigene Karte beschränkt: npc ist serverseitig gefiltert
 * abonniert, player bleibt ungefiltert (siehe GameClient) und wird hier per mapId gefiltert -
 * gleiche Aufteilung wie web_client.
 */
export class WorldSession {
  readonly events = new Emitter<WorldSessionEvents>();
  readonly worldGrid: WorldGrid;
  readonly localPlayerId: bigint;
  readonly mapId: number;
  readonly players = new Map<bigint, PlayerRow>();
  readonly npcs = new Map<bigint, NpcRow>();
  private readonly local: PredictedPosition;

  constructor(
    private readonly conn: DbConnection,
    localRow: PlayerRow,
    worldGrid: WorldGrid
  ) {
    this.worldGrid = worldGrid;
    this.localPlayerId = localRow.playerId;
    this.mapId = localRow.mapId;
    this.local = new PredictedPosition(localRow.posX, localRow.posY);

    for (const row of conn.db.player.iter()) {
      if (row.mapId === this.mapId) this.players.set(row.playerId, row);
    }
    for (const row of conn.db.npc.iter()) {
      if (row.mapId === this.mapId) this.npcs.set(row.npcId, row);
    }
  }

  get localPlayer(): PlayerRow | undefined {
    return this.players.get(this.localPlayerId);
  }

  /** Vorhergesagte eigene Kachel (was der Client zeigt und wovon der nächste Schritt ausgeht). */
  get localPosition(): Point {
    return { x: this.local.x, y: this.local.y };
  }

  isWalkable(x: number, y: number): boolean {
    return isWalkableBiom(this.worldGrid.getBiom(x, y));
  }

  // ---- Aktionen ----

  /**
   * Ein Feld in Richtung `dir`: lokal vorhersagen (Kollision wie web_client) und per
   * UpdatePosition senden. Der Server prüft erneut (IstBegehbar) und bleibt die Autorität -
   * Abgleich in settleStep(), siehe PredictedPosition. Rückgabe: ob ein Schritt ausgelöst wurde.
   */
  step(dir: Direction): boolean {
    if (!this.localPlayer) return false;
    const target = this.local.tryStep(
      dir,
      (x, y) => this.isWalkable(x, y),
      this.worldGrid.breite,
      this.worldGrid.hoehe
    );
    if (!target) return false;
    this.events.emit("localMoved", target, false);
    this.conn.reducers.updatePosition({ x: target.x, y: target.y }).then(
      () => this.settleStep(),
      (exc) => {
        this.settleStep();
        this.notify(errorMessage(exc), "error");
      }
    );
    return true;
  }

  collectQi(): void {
    this.conn.reducers.qiSammeln({}).catch((exc) => this.notify(errorMessage(exc), "error"));
  }

  /** Durchbruch-Versuch; das Ergebnis (Stufe gestiegen / Qi halbiert) wird als notice gemeldet. */
  async breakthrough(): Promise<void> {
    const before = this.localPlayer;
    if (!before) return;
    try {
      await this.conn.reducers.durchbruch({});
    } catch (exc) {
      this.notify(errorMessage(exc), "error");
      return;
    }
    // Promise erfüllt => Row-Diffs sind bereits im Cache/angewendet (siehe GameClient.register).
    const after = this.localPlayer;
    if (!after) return;
    if (after.stufe > before.stufe) {
      this.notify(`Durchbruch gelungen! Jetzt Stufe ${after.stufe}.`, "success");
    } else if (after.qi !== before.qi) {
      this.notify("Durchbruch fehlgeschlagen - das Qi ist auf die Hälfte gefallen.", "warning");
    }
  }

  /** Nächster angreifbarer NPC (alle 8 Nachbarfelder), oder null. Nur UX - der Server prüft selbst. */
  nearestAttackTarget(): NpcRow | null {
    return nearestInRange(this.local.x, this.local.y, this.npcs.values());
  }

  attack(): void {
    const target = this.nearestAttackTarget();
    if (!target) return;
    this.conn.reducers.angreifen({ npcId: target.npcId }).catch((exc) => this.notify(errorMessage(exc), "error"));
  }

  notify(message: string, kind: NoticeKind): void {
    this.events.emit("notice", message, kind);
  }

  // ---- Eingehende Row-Diffs (von GameClient weitergeleitet) ----

  applyPlayer(row: PlayerRow): void {
    if (row.mapId !== this.mapId) {
      this.removePlayer(row.playerId);
      return;
    }
    this.players.set(row.playerId, row);
    if (row.playerId === this.localPlayerId && this.local.serverUpdate({ x: row.posX, y: row.posY })) {
      this.events.emit("localMoved", this.localPosition, true);
    }
    this.events.emit("playerChanged", row);
  }

  removePlayer(playerId: bigint): void {
    if (this.players.delete(playerId)) this.events.emit("playerRemoved", playerId);
  }

  applyNpc(row: NpcRow): void {
    if (row.mapId !== this.mapId) {
      this.removeNpc(row.npcId);
      return;
    }
    this.npcs.set(row.npcId, row);
    this.events.emit("npcChanged", row);
  }

  removeNpc(npcId: bigint): void {
    if (this.npcs.delete(npcId)) this.events.emit("npcRemoved", npcId);
  }

  applyTile(row: WorldTileRow): void {
    if (row.mapId !== this.mapId) return;
    this.worldGrid.setTile(row.x, row.y, {
      biom: row.biomTyp,
      kraeuter: row.kraeuterMenge,
      spiritStones: row.spiritStones,
      holz: row.holz,
      erz: row.erz,
    });
    this.events.emit("tileChanged", row.x, row.y);
  }

  private settleStep(): void {
    const row = this.conn.db.player.PlayerId.find(this.localPlayerId);
    if (this.local.settle(row ? { x: row.posX, y: row.posY } : null)) {
      this.events.emit("localMoved", this.localPosition, true);
    }
  }
}
