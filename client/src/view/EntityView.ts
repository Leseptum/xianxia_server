import * as Phaser from "phaser";
import { InterpolatedPosition } from "../logic/interpolation";
import { tileToWorld, type TileMetrics, type Point } from "../logic/projection";
import { FEET_ORIGIN, TEXTURES } from "./textures";

// Tiefensortierung nach Y: Figuren bekommen als Depth die Welt-Y ihres Fußpunkts (weiter unten
// auf dem Bildschirm = weiter vorne). Der Boden liegt weit darunter (GROUND_DEPTH),
// Namensschilder/HP-Balken weit darüber, damit sie nie von Figuren davor verdeckt werden.
const LABEL_DEPTH = 1_000_000;

export interface EntityStyle {
  texture: typeof TEXTURES.player | typeof TEXTURES.creature;
  tint: number;
  /** Markierungsring unter den Füßen (eigener Spieler). */
  ring?: number;
  /** Tiefen-Bonus bei exakt gleichem Y (eigener Spieler vor NPC auf derselben Kachel). */
  depthBias?: number;
}

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "system-ui, sans-serif",
  fontSize: "12px",
  color: "#ffffff",
  stroke: "#000000",
  strokeThickness: 3,
  resolution: 2,
};

/** Darstellung eines Spielers oder NPCs: Sprite + Name (+ HP-Balken), interpoliert bewegt. */
export class EntityView {
  readonly motion: InterpolatedPosition;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private readonly ring: Phaser.GameObjects.Image | null;
  private hpBg: Phaser.GameObjects.Rectangle | null = null;
  private hpFill: Phaser.GameObjects.Rectangle | null = null;
  private readonly headOffset: number;
  private readonly depthBias: number;
  private readonly world: Point = { x: 0, y: 0 };

  constructor(
    scene: Phaser.Scene,
    private readonly metrics: TileMetrics,
    x: number,
    y: number,
    style: EntityStyle,
    labelText: string
  ) {
    this.motion = new InterpolatedPosition(x, y);
    const origin = FEET_ORIGIN[style.texture];
    this.sprite = scene.add.image(0, 0, style.texture).setOrigin(origin.x, origin.y).setTint(style.tint);
    this.headOffset = this.sprite.height * origin.y;
    this.ring = style.ring !== undefined ? scene.add.image(0, 0, TEXTURES.ring).setTint(style.ring) : null;
    this.label = scene.add.text(0, 0, labelText, LABEL_STYLE).setOrigin(0.5, 1);
    this.depthBias = style.depthBias ?? 0;
    this.update(0);
  }

  /** Aktuelle (interpolierte) Fußposition in Weltkoordinaten - Ziel für die Kamera. */
  get worldPosition(): Point {
    return this.world;
  }

  get followTarget(): Phaser.GameObjects.Image {
    return this.sprite;
  }

  setLabel(text: string): void {
    if (this.label.text !== text) this.label.setText(text);
  }

  setHp(hp: number, max: number): void {
    const scene = this.sprite.scene;
    if (!this.hpBg || !this.hpFill) {
      this.hpBg = scene.add.rectangle(0, 0, 26, 4, 0x000000, 0.7).setOrigin(0.5, 1);
      this.hpFill = scene.add.rectangle(0, 0, 26, 4, 0x5ad65a).setOrigin(0, 1);
    }
    const ratio = max > 0 ? Math.min(Math.max(hp / max, 0), 1) : 0;
    this.hpFill.setSize(26 * ratio, 4);
    this.hpFill.setFillStyle(ratio > 0.5 ? 0x5ad65a : ratio > 0.25 ? 0xe0c040 : 0xe05050);
  }

  moveTo(x: number, y: number, nowMs: number, durationMs: number, snapDistance: number): void {
    this.motion.setTarget(x, y, nowMs, durationMs, snapDistance);
  }

  update(nowMs: number, showLabel = true): void {
    const p = this.motion.sample(nowMs);
    const w = tileToWorld(p.x, p.y, this.metrics);
    this.world.x = w.x;
    this.world.y = w.y;

    this.sprite.setPosition(w.x, w.y).setDepth(w.y + this.depthBias);
    if (this.ring) this.ring.setPosition(w.x, w.y).setDepth(w.y + this.depthBias - 0.01);

    const top = w.y - this.headOffset - 2;
    if (this.hpBg && this.hpFill) {
      this.hpBg.setPosition(w.x, top).setDepth(LABEL_DEPTH + w.y);
      this.hpFill.setPosition(w.x - 13, top).setDepth(LABEL_DEPTH + w.y + 0.01);
      this.label.setPosition(w.x, top - 6);
    } else {
      this.label.setPosition(w.x, top);
    }
    this.label.setDepth(LABEL_DEPTH + w.y).setVisible(showLabel);
    this.hpBg?.setVisible(showLabel);
    this.hpFill?.setVisible(showLabel);
  }

  destroy(): void {
    this.sprite.destroy();
    this.label.destroy();
    this.ring?.destroy();
    this.hpBg?.destroy();
    this.hpFill?.destroy();
  }
}
