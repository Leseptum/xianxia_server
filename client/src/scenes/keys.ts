import type { GameClient } from "../net/GameClient";
import type { WorldSession } from "../net/WorldSession";

export const SCENES = {
  boot: "Boot",
  login: "Login",
  world: "World",
  hud: "Hud",
} as const;

/** Szenen-Daten: Netzwerk-Objekte werden explizit von Szene zu Szene weitergereicht. */
export interface LoginSceneData {
  client: GameClient;
}

export interface WorldSceneData {
  client: GameClient;
  session: WorldSession;
}
