import * as Phaser from "phaser";
import type { Player as PlayerRow } from "../module_bindings/types";
import type { GameClient } from "../net/GameClient";
import { errorMessage } from "../net/errors";
import { SCENES, type LoginSceneData, type WorldSceneData } from "./keys";

// Phaser hat keine Texteingabe - das Formular ist ein DOMElement der Szene (dom.createContainer
// in main.ts) und verschwindet mit ihr. novalidate: leere Felder meldet handleAuth selbst (wie
// web_client), statt dass die native Browser-Validierung den Login-Submit still blockiert.
const LOGIN_HTML = `
<form class="login-panel" autocomplete="on" novalidate>
  <h1>Xianxia</h1>
  <label>Name <input type="text" name="name" autocomplete="username" required /></label>
  <label>Passwort <input type="password" name="password" autocomplete="current-password" required /></label>
  <div class="button-row">
    <button type="button" name="register">Registrieren</button>
    <button type="submit" name="login">Login</button>
  </div>
  <p class="status" aria-live="polite"></p>
  <button type="button" name="logout" class="link-button">Logout (neue Identity erzwingen)</button>
</form>`;

/** Login/Registrierung - gleicher Ablauf und gleiche Meldungen wie web_client. */
export class LoginScene extends Phaser.Scene {
  private client!: GameClient;
  private form!: HTMLFormElement;

  constructor() {
    super(SCENES.login);
  }

  init(data: LoginSceneData): void {
    this.client = data.client;
  }

  create(): void {
    const dom = this.add.dom(this.scale.width / 2, this.scale.height / 2).createFromHTML(LOGIN_HTML);
    this.form = dom.node.querySelector("form") ?? (dom.node as HTMLFormElement);

    const onResize = (size: Phaser.Structs.Size) => dom.setPosition(size.width / 2, size.height / 2);
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));

    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.handleAuth((n, p) => this.client.login(n, p));
    });
    this.button("register").addEventListener("click", () => void this.handleAuth((n, p) => this.client.register(n, p)));
    this.button("logout").addEventListener("click", () => this.client.logout());

    this.setBusy(true);
    this.setStatus("Verbinde mit Server...", false);
    this.client.start().then(
      () => {
        this.setBusy(false);
        this.setStatus("", false);
        this.field("name").focus();
      },
      // Bleibt "busy": ohne Verbindung ist weder Login noch Registrierung möglich.
      (exc) => this.setStatus(errorMessage(exc), true)
    );
  }

  private async handleAuth(action: (name: string, password: string) => Promise<PlayerRow>): Promise<void> {
    const name = this.field("name").value.trim();
    const password = this.field("password").value;
    if (!name || !password) {
      this.setStatus("Name und Passwort dürfen nicht leer sein.", true);
      return;
    }

    this.setBusy(true);
    this.setStatus("Verbinde mit Server...", false);
    try {
      const row = await action(name, password);
      this.setStatus(`Willkommen, ${row.name}! Lade Welt...`, false);
      const session = await this.client.enterWorld(row);
      this.scene.start(SCENES.world, { client: this.client, session } satisfies WorldSceneData);
    } catch (exc) {
      this.setStatus(errorMessage(exc), true);
      this.setBusy(false);
    }
  }

  private field(name: string): HTMLInputElement {
    return this.form.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  }

  private button(name: string): HTMLButtonElement {
    return this.form.querySelector(`button[name="${name}"]`) as HTMLButtonElement;
  }

  private setBusy(busy: boolean): void {
    for (const el of this.form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) {
      if (el.name !== "logout") el.disabled = busy;
    }
  }

  private setStatus(message: string, isError: boolean): void {
    const el = this.form.querySelector(".status") as HTMLElement;
    el.textContent = message;
    el.classList.toggle("error", isError);
  }
}
