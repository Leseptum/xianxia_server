import * as Phaser from "phaser";
import type { GameClient } from "../net/GameClient";
import type { NoticeKind, WorldSession } from "../net/WorldSession";
import { Button } from "../view/Button";
import { MapOverlay } from "../view/MapOverlay";
import { SCENES, type WorldSceneData } from "./keys";

const FONT = "system-ui, sans-serif";
const QI_BAR_WIDTH = 256;
const ACTION_W = 130;
const ACTION_H = 40;
const GAP = 8;
const MARGIN = 12;
const HUD_DEPTH = 10; // über dem Karten-Overlay (Tiefe 0-2)
const PANEL_W = QI_BAR_WIDTH + 24;
const PANEL_H = 74;
const SMALL_W = 100;
const SMALL_H = 32;

const NOTICE_COLORS: Record<NoticeKind, string> = {
  info: "#dcdcdc",
  success: "#96e696",
  warning: "#f0c060",
  error: "#e67878",
};

/**
 * HUD als eigene Szene über der WorldScene: eigene Kamera (Zoom der Welt wirkt hier nicht),
 * liest nur aus der WorldSession und ruft deren Aktionen auf.
 */
export class HudScene extends Phaser.Scene {
  private client!: GameClient;
  private session!: WorldSession;
  private panel!: Phaser.GameObjects.Rectangle;
  private nameText!: Phaser.GameObjects.Text;
  private qiText!: Phaser.GameObjects.Text;
  private qiBarBg!: Phaser.GameObjects.Rectangle;
  private qiBarFill!: Phaser.GameObjects.Rectangle;
  private collectButton!: Button;
  private breakthroughButton!: Button;
  private attackButton!: Button;
  private mapButton!: Button;
  private logoutButton!: Button;
  private helpText!: Phaser.GameObjects.Text;
  private notice!: Phaser.GameObjects.Text;
  private noticeTimer: Phaser.Time.TimerEvent | null = null;
  private mapOverlay!: MapOverlay;

  constructor() {
    super(SCENES.hud);
  }

  init(data: WorldSceneData): void {
    this.client = data.client;
    this.session = data.session;
    this.noticeTimer = null;
  }

  create(): void {
    this.mapOverlay = new MapOverlay(this, this.session);
    this.mapOverlay.setDepth(0);

    this.panel = this.add.rectangle(MARGIN, MARGIN, PANEL_W, PANEL_H, 0x0a0a14, 0.72).setOrigin(0, 0);
    this.panel.setStrokeStyle(1, 0x50505a, 0.8);
    this.nameText = this.add.text(0, 0, "", { fontFamily: FONT, fontSize: "16px", color: "#f0f0f0", fontStyle: "bold", resolution: 2 });
    this.qiBarBg = this.add.rectangle(0, 0, QI_BAR_WIDTH, 14, 0x23232d).setOrigin(0, 0).setStrokeStyle(1, 0x50505a);
    this.qiBarFill = this.add.rectangle(0, 0, 0, 14, 0x6ec8ff).setOrigin(0, 0);
    this.qiText = this.add.text(0, 0, "", { fontFamily: FONT, fontSize: "12px", color: "#c8c8d2", resolution: 2 });

    this.collectButton = new Button(this, "Qi sammeln", ACTION_W, ACTION_H, 0x2f6f4f, () => this.session.collectQi());
    this.breakthroughButton = new Button(this, "Durchbruch", ACTION_W, ACTION_H, 0x6f4f9f, () => {
      void this.session.breakthrough();
    });
    this.attackButton = new Button(this, "Angreifen", ACTION_W, ACTION_H, 0x9f3f3f, () => this.session.attack());
    this.mapButton = new Button(this, "Karte (M)", SMALL_W, SMALL_H, 0x3a3a4a, () => this.mapOverlay.toggle());
    this.logoutButton = new Button(this, "Logout", SMALL_W, SMALL_H, 0x3a3a4a, () => this.client.logout());

    this.helpText = this.add
      .text(0, 0, "WASD / Pfeiltasten: laufen · Mausrad: Zoom · M: Karte", {
        fontFamily: FONT,
        fontSize: "12px",
        color: "#b4b4be",
        backgroundColor: "#00000080",
        padding: { x: 6, y: 3 },
        resolution: 2,
      })
      .setOrigin(0, 1);
    this.notice = this.add
      .text(0, 0, "", {
        fontFamily: FONT,
        fontSize: "14px",
        color: "#ffffff",
        backgroundColor: "#000000b0",
        padding: { x: 10, y: 6 },
        align: "center",
        resolution: 2,
      })
      .setOrigin(0.5, 0)
      .setVisible(false);

    for (const o of [
      this.panel,
      this.nameText,
      this.qiBarBg,
      this.qiBarFill,
      this.qiText,
      this.collectButton,
      this.breakthroughButton,
      this.attackButton,
      this.mapButton,
      this.logoutButton,
      this.helpText,
      this.notice,
    ]) {
      o.setDepth(HUD_DEPTH);
    }

    this.input.keyboard?.on("keydown-M", () => this.mapOverlay.toggle());

    const localId = this.session.localPlayerId;
    const ev = this.session.events;
    const unsubscribe = [
      ev.on("playerChanged", (row) => {
        if (row.playerId === localId) this.refreshStats();
      }),
      ev.on("playerRemoved", (id) => {
        if (id === localId) this.refreshStats();
      }),
      ev.on("notice", (message, kind) => this.showNotice(message, kind)),
      ev.on("tileChanged", () => this.mapOverlay.markTileDirty()),
    ];
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribe.forEach((off) => off());
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });

    this.layout();
    this.refreshStats();
  }

  update(): void {
    // Hängt an der (vorhergesagten) eigenen Position und an NPC-Bewegungen - jeden Frame prüfen.
    this.attackButton.setEnabled(this.session.localPlayer !== undefined && this.session.nearestAttackTarget() !== null);
    this.mapOverlay.update();
  }

  private refreshStats(): void {
    const local = this.session.localPlayer;
    if (!local) {
      this.nameText.setText("Warte auf Server-Daten...");
      this.qiText.setText("");
      this.qiBarFill.setSize(0, 14);
      this.collectButton.setEnabled(false);
      this.breakthroughButton.setEnabled(false);
      return;
    }
    this.nameText.setText(`${local.name} - Stufe ${local.stufe}`);
    this.qiText.setText(`Qi: ${local.qi} / ${local.qiMaximum}`);
    const ratio = local.qiMaximum === 0n ? 0 : Math.min(Number(local.qi) / Number(local.qiMaximum), 1);
    this.qiBarFill.setSize(QI_BAR_WIDTH * ratio, 14);
    this.collectButton.setEnabled(true);
    this.breakthroughButton.setEnabled(local.qi >= local.qiMaximum);
  }

  private showNotice(message: string, kind: NoticeKind): void {
    this.noticeTimer?.remove();
    this.tweens.killTweensOf(this.notice);
    this.notice.setText(message).setColor(NOTICE_COLORS[kind]).setAlpha(1).setVisible(true);
    this.noticeTimer = this.time.delayedCall(kind === "error" ? 6000 : 3500, () => {
      this.tweens.add({ targets: this.notice, alpha: 0, duration: 400 });
    });
  }

  private layout(): void {
    const { width, height } = this.scale;

    this.panel.setPosition(MARGIN, MARGIN);
    this.nameText.setPosition(MARGIN + 12, MARGIN + 10);
    this.qiBarBg.setPosition(MARGIN + 12, MARGIN + 36);
    this.qiBarFill.setPosition(MARGIN + 12, MARGIN + 36);
    this.qiText.setPosition(MARGIN + 12, MARGIN + 53);

    // Karte/Logout oben rechts - passt das nicht neben das Panel, rutschen sie darunter.
    const smallRowW = 2 * SMALL_W + GAP;
    const besidePanel = width >= MARGIN + PANEL_W + GAP + smallRowW + MARGIN;
    const smallY = besidePanel ? MARGIN + SMALL_H / 2 : MARGIN + PANEL_H + GAP + SMALL_H / 2;
    this.logoutButton.setPosition(width - MARGIN - SMALL_W / 2, smallY);
    this.mapButton.setPosition(width - MARGIN - SMALL_W - GAP - SMALL_W / 2, smallY);

    // Aktions-Buttons unten rechts: nebeneinander, oder bei schmalem Fenster übereinander.
    const actions = [this.collectButton, this.breakthroughButton, this.attackButton];
    const rowWidth = actions.length * ACTION_W + (actions.length - 1) * GAP;
    const asRow = width >= rowWidth + 2 * MARGIN + 340;
    actions.forEach((button, i) => {
      if (asRow) {
        button.setPosition(width - MARGIN - rowWidth + i * (ACTION_W + GAP) + ACTION_W / 2, height - MARGIN - ACTION_H / 2);
      } else {
        const fromBottom = actions.length - 1 - i;
        button.setPosition(width - MARGIN - ACTION_W / 2, height - MARGIN - ACTION_H / 2 - fromBottom * (ACTION_H + GAP));
      }
    });

    this.helpText.setPosition(MARGIN, height - MARGIN);
    this.helpText.setWordWrapWidth(Math.max(120, width - (asRow ? rowWidth : ACTION_W) - 3 * MARGIN));
    this.notice.setPosition(width / 2, besidePanel ? MARGIN + PANEL_H + 2 * GAP : smallY + SMALL_H / 2 + 2 * GAP);
    this.notice.setWordWrapWidth(Math.max(160, width - 4 * MARGIN));
    this.mapOverlay.layout(width, height);
  }
}
