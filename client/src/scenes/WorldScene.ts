import * as Phaser from "phaser";
import { CONFIG } from "../config";
import type { Npc as NpcRow, Player as PlayerRow } from "../module_bindings/types";
import type { GameClient } from "../net/GameClient";
import type { WorldSession } from "../net/WorldSession";
import { directionFromKeys } from "../logic/movement";
import { chebyshev } from "../logic/interpolation";
import { isoMapBounds, tileToWorld, type IsoMetrics, type Point } from "../logic/iso";
import { NPC_ART_NAMES, NPC_KATEGORIE_FARBEN } from "../npc";
import { createIsoGround, type IsoGround } from "../view/isoGround";
import { EntityView, type EntityStyle } from "../view/EntityView";
import { TEXTURES } from "../view/textures";
import { SCENES, type WorldSceneData } from "./keys";

const METRICS: IsoMetrics = { tileWidth: CONFIG.TILE_WIDTH, tileHeight: CONFIG.TILE_HEIGHT };
// Kamera zielt ~eine halbe Figurenhöhe über den Fußpunkt, damit die Figur mittig im Bild steht.
const CAMERA_OFFSET_Y = 20;

// Farben wie web_client (eigener Spieler gelb, andere magenta, NPCs nach Kategorie).
const LOCAL_STYLE: EntityStyle = { texture: TEXTURES.player, tint: 0xffd23c, ring: 0xffd23c, depthBias: 0.5 };
const REMOTE_STYLE: EntityStyle = { texture: TEXTURES.player, tint: 0xc850dc };
const npcStyle = (kategorie: number): EntityStyle => ({
  texture: TEXTURES.creature,
  tint: Phaser.Display.Color.HexStringToColor(NPC_KATEGORIE_FARBEN[kategorie] ?? "#ffffff").color,
});

type HeldKeys = Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key[]>;

/**
 * Spielwelt: isometrische Tilemap der Karte, Spieler + NPCs live aus der WorldSession
 * (interpoliert), eigene Bewegung per WASD/Pfeiltasten, Kamera folgt, Mausrad zoomt.
 * Startet die HudScene parallel als eigene Szene (eigene, ungezoomte Kamera).
 */
export class WorldScene extends Phaser.Scene {
  private client!: GameClient;
  private session!: WorldSession;
  private ground!: IsoGround;
  private readonly playerViews = new Map<bigint, EntityView>();
  private readonly npcViews = new Map<bigint, EntityView>();
  private heldKeys!: HeldKeys;
  private lastStepAt = -Infinity;
  private following = false;

  constructor() {
    super(SCENES.world);
  }

  init(data: WorldSceneData): void {
    this.client = data.client;
    this.session = data.session;
    this.playerViews.clear();
    this.npcViews.clear();
    this.lastStepAt = -Infinity;
    this.following = false;
  }

  create(): void {
    this.ground = createIsoGround(this, this.session.worldGrid, METRICS);

    const now = performance.now();
    for (const row of this.session.players.values()) this.upsertPlayer(row, now);
    for (const row of this.session.npcs.values()) this.upsertNpc(row, now);

    const ev = this.session.events;
    const unsubscribe = [
      ev.on("playerChanged", (row) => this.upsertPlayer(row, performance.now())),
      ev.on("playerRemoved", (id) => this.removeView(this.playerViews, id)),
      ev.on("npcChanged", (row) => this.upsertNpc(row, performance.now())),
      ev.on("npcRemoved", (id) => this.removeView(this.npcViews, id)),
      ev.on("tileChanged", (x, y) => this.ground.refreshTile(x, y)),
      ev.on("localMoved", (pos, correction) => this.moveLocalView(pos, correction)),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => unsubscribe.forEach((off) => off()));

    this.setupCamera();
    this.setupInput();

    // Bei Fenstergrößen-Änderung sofort neu zentrieren statt per Frame-Lerp hinzugleiten.
    const recenter = () => this.centerCameraOnLocal();
    this.scale.on(Phaser.Scale.Events.RESIZE, recenter);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, recenter));

    this.scene.launch(SCENES.hud, { client: this.client, session: this.session } satisfies WorldSceneData);
  }

  update(): void {
    const now = performance.now();

    // Feld-Schritte im STEP_INTERVAL_MS-Takt, solange eine Richtungstaste gehalten wird (wie web_client).
    const dir = directionFromKeys({
      up: this.isHeld("up"),
      down: this.isHeld("down"),
      left: this.isHeld("left"),
      right: this.isHeld("right"),
    });
    if (dir && now - this.lastStepAt >= CONFIG.STEP_INTERVAL_MS && this.session.step(dir)) {
      this.lastStepAt = now;
    }

    const showLabels = this.cameras.main.zoom >= CONFIG.LABEL_MIN_ZOOM;
    for (const view of this.playerViews.values()) view.update(now, showLabels);
    for (const view of this.npcViews.values()) view.update(now, showLabels);
  }

  // ---- Figuren ----

  private upsertPlayer(row: PlayerRow, now: number): void {
    const isLocal = row.playerId === this.session.localPlayerId;
    let view = this.playerViews.get(row.playerId);
    if (!view) {
      // Eigener Spieler: Position kommt aus der Vorhersage (session.localPosition), nicht aus der
      // Serverzeile - die hängt bei laufenden Schritten zwangsläufig hinterher.
      const start: Point = isLocal ? this.session.localPosition : { x: row.posX, y: row.posY };
      view = new EntityView(this, METRICS, start.x, start.y, isLocal ? LOCAL_STYLE : REMOTE_STYLE, row.name);
      this.playerViews.set(row.playerId, view);
      if (isLocal) this.followLocal(view);
    } else if (!isLocal) {
      view.moveTo(row.posX, row.posY, now, CONFIG.PLAYER_MOVE_MS, CONFIG.SNAP_DISTANCE);
    }
    view.setLabel(`${row.name} · Stufe ${row.stufe}`);
  }

  private upsertNpc(row: NpcRow, now: number): void {
    let view = this.npcViews.get(row.npcId);
    if (!view) {
      view = new EntityView(this, METRICS, row.posX, row.posY, npcStyle(row.kategorie), "");
      this.npcViews.set(row.npcId, view);
    } else {
      view.moveTo(row.posX, row.posY, now, CONFIG.NPC_MOVE_MS, CONFIG.SNAP_DISTANCE);
    }
    view.setLabel(`${NPC_ART_NAMES[row.art] ?? `Art ${row.art}`} ${row.hp}/${row.hpMaximum}`);
    view.setHp(row.hp, row.hpMaximum);
  }

  private moveLocalView(pos: Point, correction: boolean): void {
    const view = this.playerViews.get(this.session.localPlayerId);
    if (!view) return;
    const now = performance.now();
    if (correction && chebyshev(view.motion.sample(now), pos) > CONFIG.SNAP_DISTANCE) {
      // Teleport (Editor-Verschiebung, größere Server-Korrektur): Figur UND Kamera direkt
      // versetzen - Phasers Follow-Lerp ist pro Frame und würde sonst quer über die Karte gleiten.
      view.motion.snapTo(pos.x, pos.y);
      view.update(now);
      this.centerCameraOnLocal();
      return;
    }
    // Eigener Schritt bzw. kleine Korrektur: gleitend über die Schrittdauer.
    view.moveTo(pos.x, pos.y, now, CONFIG.PLAYER_MOVE_MS, Infinity);
  }

  private centerCameraOnLocal(): void {
    const view = this.playerViews.get(this.session.localPlayerId);
    if (view) this.cameras.main.centerOn(view.worldPosition.x, view.worldPosition.y - CAMERA_OFFSET_Y);
  }

  private removeView(views: Map<bigint, EntityView>, id: bigint): void {
    if (views === this.playerViews && id === this.session.localPlayerId) {
      // Eigener Spieler gelöscht (Editor "Spieler löschen"): nicht an einem zerstörten Sprite hängen bleiben.
      this.cameras.main.stopFollow();
      this.following = false;
    }
    views.get(id)?.destroy();
    views.delete(id);
  }

  // ---- Kamera & Eingabe ----

  private setupCamera(): void {
    const cam = this.cameras.main;
    const b = isoMapBounds(this.session.worldGrid.breite, this.session.worldGrid.hoehe, METRICS);
    const pad = 8 * CONFIG.TILE_WIDTH;
    cam.setBounds(b.x - pad, b.y - pad, b.width + 2 * pad, b.height + 2 * pad);
    cam.setZoom(CONFIG.ZOOM_DEFAULT);
    const start = tileToWorld(this.session.localPosition.x, this.session.localPosition.y, METRICS);
    cam.centerOn(start.x, start.y - CAMERA_OFFSET_Y);

    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
        // Proportional zu deltaY: eine Mausrad-Raste (~100) = ein ZOOM_STEP, Trackpads zoomen fein.
        const steps = Phaser.Math.Clamp(dy, -300, 300) / 100;
        const zoom = Phaser.Math.Clamp(cam.zoom * Math.pow(CONFIG.ZOOM_STEP, -steps), CONFIG.ZOOM_MIN, CONFIG.ZOOM_MAX);
        cam.setZoom(zoom);
      }
    );
  }

  private followLocal(view: EntityView): void {
    if (this.following) return;
    this.following = true;
    this.cameras.main.startFollow(view.followTarget, false, CONFIG.CAMERA_LERP, CONFIG.CAMERA_LERP, 0, CAMERA_OFFSET_Y);
  }

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (!kb) throw new Error("Keine Tastatur-Eingabe verfügbar.");
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.heldKeys = {
      up: [kb.addKey(K.W), kb.addKey(K.UP)],
      down: [kb.addKey(K.S), kb.addKey(K.DOWN)],
      left: [kb.addKey(K.A), kb.addKey(K.LEFT)],
      right: [kb.addKey(K.D), kb.addKey(K.RIGHT)],
    };
  }

  private isHeld(dir: keyof HeldKeys): boolean {
    return this.heldKeys[dir].some((key) => key.isDown);
  }
}
