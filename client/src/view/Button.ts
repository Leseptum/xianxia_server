import * as Phaser from "phaser";

const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "system-ui, sans-serif",
  fontSize: "14px",
  color: "#f0f0f0",
  resolution: 2,
};

/** Einfacher HUD-Button (Rechteck + Text) mit Hover- und Deaktiviert-Zustand. */
export class Button extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly caption: Phaser.GameObjects.Text;
  private enabled = true;
  private hovered = false;

  constructor(
    scene: Phaser.Scene,
    text: string,
    width: number,
    height: number,
    private readonly color: number,
    onClick: () => void
  ) {
    super(scene, 0, 0);
    this.bg = scene.add.rectangle(0, 0, width, height, color).setStrokeStyle(1, 0x000000, 0.6);
    this.caption = scene.add.text(0, 0, text, TEXT_STYLE).setOrigin(0.5);
    this.add([this.bg, this.caption]);
    this.setSize(width, height);

    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => {
      this.hovered = true;
      this.redraw();
    });
    this.bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
      this.hovered = false;
      this.redraw();
    });
    this.bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      if (this.enabled) onClick();
    });
    scene.add.existing(this);
  }

  setEnabled(enabled: boolean): this {
    if (this.enabled === enabled) return this;
    this.enabled = enabled;
    if (this.bg.input) this.bg.input.cursor = enabled ? "pointer" : "default";
    this.redraw();
    return this;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private redraw(): void {
    const c = Phaser.Display.Color.IntegerToColor(this.color);
    if (this.enabled && this.hovered) c.lighten(12);
    this.bg.setFillStyle(c.color);
    this.setAlpha(this.enabled ? 1 : 0.4);
  }
}
