import * as Phaser from "phaser";
import "./style.css";
import { BootScene } from "./scenes/BootScene";
import { LoginScene } from "./scenes/LoginScene";
import { WorldScene } from "./scenes/WorldScene";
import { HudScene } from "./scenes/HudScene";

// Szenen-Fluss: Boot (Texturen, Verbindungsaufbau) -> Login (DOM-Formular) -> World (+ Hud
// parallel). Netzwerk-Code liegt in src/net/ und wird als Szenen-Daten weitergereicht.
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#0a0a0f",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  dom: { createContainer: true },
  scene: [BootScene, LoginScene, WorldScene, HudScene],
});
