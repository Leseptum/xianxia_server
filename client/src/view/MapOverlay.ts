import * as Phaser from "phaser";
import type { WorldSession } from "../net/WorldSession";
import { NPC_KATEGORIE_FARBEN } from "../npc";

const MINIMAP_TEXTURE = "minimap";

/**
 * Ganzkarten-Ansicht (Taste M, wie web_client) - in derselben Diamond-Ausrichtung wie die
 * Spielwelt, damit "W = rechts oben" auch auf der Karte stimmt. Nutzt die Top-Down-Minimap,
 * die WorldGrid ohnehin vorrendert (1 px pro Kachel): um 45° gedreht und in einem auf halbe
 * Höhe gestauchten Container ergibt sie genau die Iso-Raute.
 */
export class MapOverlay {
  private readonly backdrop: Phaser.GameObjects.Rectangle;
  private readonly frame: Phaser.GameObjects.Container;
  private readonly image: Phaser.GameObjects.Image;
  private readonly dots: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private visible = false;
  private textureDirty = false;
  // Kantenlänge einer Kachel in der Kartenansicht (Breite der Raute), neu berechnet in layout().
  private s = 1;

  constructor(
    scene: Phaser.Scene,
    private readonly session: WorldSession
  ) {
    const grid = session.worldGrid;
    // Die Textur hängt am Canvas des WorldGrid - setTile() zeichnet dort bereits nach, ein
    // refresh() lädt sie neu auf die GPU.
    if (scene.textures.exists(MINIMAP_TEXTURE)) scene.textures.remove(MINIMAP_TEXTURE);
    const tex = scene.textures.addCanvas(MINIMAP_TEXTURE, grid.minimapCanvas);
    if (!tex) throw new Error("Konnte Kartentextur nicht anlegen.");
    this.texture = tex;
    this.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

    // Liegt unter den HUD-Elementen (siehe HudScene) - Buttons bleiben bei offener Karte bedienbar.
    this.backdrop = scene.add.rectangle(0, 0, 10, 10, 0x05050a, 0.82).setOrigin(0, 0);
    this.image = scene.add.image(0, 0, MINIMAP_TEXTURE).setOrigin(0, 0).setAngle(45);
    this.frame = scene.add.container(0, 0, [this.image]).setScale(1, 0.5);
    this.dots = scene.add.graphics();
    this.title = scene.add
      .text(0, 0, "Karte - M zum Schließen", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#c8c8d2",
        resolution: 2,
      })
      .setOrigin(0.5, 0);
    this.setVisible(false);
  }

  get isOpen(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  markTileDirty(): void {
    this.textureDirty = true;
  }

  layout(width: number, height: number): void {
    const grid = this.session.worldGrid;
    const n = (grid.breite + grid.hoehe) / 2;
    // Raute ist n*s breit und n*s/2 hoch.
    this.s = Math.max(0.5, Math.min((width * 0.92) / n, (height * 0.84 * 2) / n));
    const mapW = n * this.s;
    const mapH = mapW / 2;
    const left = (width - mapW) / 2;
    const top = (height - mapH) / 2 + 12;

    this.backdrop.setSize(width, height);
    // Bild-Ecke (0,0) = obere Spitze der Raute = Gitter-Ecke (-0.5, -0.5) der Kachel (0, 0).
    this.frame.setPosition(left + grid.hoehe * (this.s / 2), top);
    this.image.setScale(this.s / Math.SQRT2);
    this.title.setPosition(width / 2, Math.max(8, top - 34));
  }

  update(): void {
    if (!this.visible) return;
    if (this.textureDirty) {
      this.texture.refresh();
      this.textureDirty = false;
    }
    const g = this.dots;
    g.clear();
    for (const npc of this.session.npcs.values()) {
      g.fillStyle(Phaser.Display.Color.HexStringToColor(NPC_KATEGORIE_FARBEN[npc.kategorie] ?? "#ffffff").color, 1);
      this.dot(npc.posX, npc.posY, 2.5);
    }
    for (const player of this.session.players.values()) {
      if (player.playerId === this.session.localPlayerId) continue;
      g.fillStyle(0xc850dc, 1);
      this.dot(player.posX, player.posY, 3);
    }
    const local = this.session.localPosition;
    g.fillStyle(0xffd23c, 1);
    g.lineStyle(1.5, 0x000000, 1);
    this.dot(local.x, local.y, 4.5, true);
  }

  private dot(tx: number, ty: number, r: number, outline = false): void {
    // Kachelmitte (tx+0.5, ty+0.5) im Bild -> Bildschirm, gleiche Transformation wie frame.
    const u = tx + 0.5;
    const v = ty + 0.5;
    const x = this.frame.x + (u - v) * (this.s / 2);
    const y = this.frame.y + (u + v) * (this.s / 4);
    this.dots.fillCircle(x, y, r);
    if (outline) this.dots.strokeCircle(x, y, r);
  }

  private setVisible(visible: boolean): void {
    this.visible = visible;
    for (const o of [this.backdrop, this.frame, this.dots, this.title]) o.setVisible(visible);
    if (visible) this.update();
  }

  setDepth(depth: number): void {
    this.backdrop.setDepth(depth);
    this.frame.setDepth(depth + 1);
    this.dots.setDepth(depth + 2);
    this.title.setDepth(depth + 2);
  }
}
