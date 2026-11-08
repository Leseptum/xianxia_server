import * as Phaser from "phaser";
import { CONFIG } from "../config";
import { GameClient } from "../net/GameClient";
import { createPlaceholderTextures } from "../view/textures";
import { SCENES, type LoginSceneData } from "./keys";

/**
 * Erzeugt die Platzhalter-Texturen, legt den GameClient an und beginnt sofort mit dem
 * Verbindungsaufbau (parallel zur Anzeige des Login-Formulars - die LoginScene wartet auf
 * dasselbe Promise und zeigt Fehler an).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.boot);
  }

  create(): void {
    createPlaceholderTextures(this, CONFIG.TILE_WIDTH, CONFIG.TILE_HEIGHT);
    const client = new GameClient();
    // Fehler werden in der LoginScene angezeigt (gleiches Promise) - hier nur "handled" markieren.
    client.start().catch(() => {});
    this.scene.start(SCENES.login, { client } satisfies LoginSceneData);
  }
}
