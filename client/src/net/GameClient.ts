import { tables, type DbConnection } from "../module_bindings";
import type { Player as PlayerRow } from "../module_bindings/types";
import { clearCachedIdentity, connect } from "../connection";
import { CONFIG } from "../config";
import { sha256Hex } from "../sha256";
import { loadWorld } from "../world";
import { WorldSession } from "./WorldSession";

/**
 * Einziger Besitzer der SpacetimeDB-Verbindung - Szenen sprechen nie direkt mit dem SDK,
 * sondern nur mit GameClient (Login-Phase) bzw. WorldSession (Spiel-Phase).
 *
 * Login-/Registrier-Flow 1:1 wie web_client/src/app.ts (doRegister/doLogin/startGame):
 * zweistufige Subscription - player + login_attempt UNGEFILTERT ab Verbindungsaufbau (der
 * Namens-Duplikatscheck muss alle Karten sehen), npc + world_meta/world_tile GEFILTERT auf die
 * Karte des eingeloggten Spielers, sobald die bekannt ist (enterWorld).
 */
export class GameClient {
  private connection: DbConnection | null = null;
  private session: WorldSession | null = null;
  private readyPromise: Promise<void> | null = null;

  /**
   * Baut die Verbindung auf (nur beim ersten Aufruf, danach dasselbe Promise) und abonniert
   * player + login_attempt. Erfüllt, sobald Login/Registrierung benutzbar sind.
   */
  start(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve, reject) => {
        connect(
          (conn) => {
            this.connection = conn;
            this.bindRowEvents(conn);
            conn
              .subscriptionBuilder()
              .onApplied(() => resolve())
              .onError((ctx) =>
                reject(
                  new Error(
                    `Konnte nicht mit dem Server synchronisieren: ${ctx.event?.message ?? "unbekannter Fehler"}`
                  )
                )
              )
              .subscribe([tables.player, tables.loginAttempt]);
          },
          (error) => reject(new Error(describeConnectError(error)))
        );
      });
    }
    return this.readyPromise;
  }

  async register(name: string, password: string): Promise<PlayerRow> {
    // Register no-op't serverseitig still, wenn der Name vergeben ist (Lib.cs) - ohne diesen
    // Vorab-Check würde die Zeilensuche unten die Zeile des ANDEREN Spielers finden und für
    // eine erfolgreiche Registrierung halten (der Cache ist nicht auf die eigene Identity begrenzt).
    if (this.findPlayerByName(name)) {
      throw new Error(`Name "${name}" ist bereits vergeben. Bitte einen anderen Namen wählen.`);
    }

    await this.conn().reducers.register({ name, passwordHash: sha256Hex(password) });

    // Das SDK löst das Reducer-Promise erst auf, NACHDEM die resultierenden Row-Diffs im
    // lokalen Cache angewendet sind (gleiche Server-Nachricht) - kein Polling nötig.
    const row = this.findPlayerByName(name);
    if (!row) {
      throw new Error(
        "Registrierung hat kein Spielerobjekt erzeugt. Diese Tab-Identity ist vermutlich schon " +
          "mit einem anderen Namen registriert (der Server erlaubt nur einen Spieler pro " +
          "Identity) - unten 'Logout' klicken und erneut versuchen, oder einen neuen Tab öffnen."
      );
    }
    return row;
  }

  async login(name: string, password: string): Promise<PlayerRow> {
    const row = this.findPlayerByName(name);
    if (!row) throw new Error("Login fehlgeschlagen: Spieler existiert nicht.");

    await this.conn().reducers.login({ name, passwordHash: sha256Hex(password) });

    const attempt = this.conn().db.loginAttempt.PlayerId.find(row.playerId);
    if (!attempt || !attempt.success) throw new Error("Login fehlgeschlagen: Name/Passwort falsch.");
    return row;
  }

  /**
   * Abonniert npc + world_meta/world_tile gefiltert auf die Karte des Spielers und baut daraus
   * die WorldSession. Lädt einmalig alle 65536 Kacheln der Karte (dauert spürbar, siehe
   * world.ts) - danach kommen nur noch Diffs.
   */
  async enterWorld(playerRow: PlayerRow): Promise<WorldSession> {
    const conn = this.conn();
    await subscribeNpcs(conn, playerRow.mapId);
    const worldGrid = await loadWorld(conn, playerRow.mapId);
    // Frischeste Zeile nehmen - zwischen Login und hier können Updates angekommen sein.
    const fresh = conn.db.player.PlayerId.find(playerRow.playerId) ?? playerRow;
    this.session = new WorldSession(conn, fresh, worldGrid);
    return this.session;
  }

  /** Wie web_client: Identity dieses Tabs verwerfen und neu laden. */
  logout(): void {
    clearCachedIdentity();
    location.reload();
  }

  private findPlayerByName(name: string): PlayerRow | undefined {
    for (const row of this.conn().db.player.iter()) {
      if (row.name === name) return row;
    }
    return undefined;
  }

  private conn(): DbConnection {
    if (!this.connection) throw new Error("Noch nicht mit dem Server verbunden.");
    return this.connection;
  }

  // Einmal pro Verbindung registriert; leitet an die aktuelle WorldSession weiter, sobald es
  // eine gibt. Vorher eintreffende Zeilen gehen nicht verloren: WorldSession befüllt sich beim
  // Erzeugen aus dem lokalen Cache (gleiches Muster wie initGame in web_client).
  private bindRowEvents(conn: DbConnection): void {
    conn.db.player.onInsert((_ctx, row) => this.session?.applyPlayer(row));
    conn.db.player.onUpdate((_ctx, _old, row) => this.session?.applyPlayer(row));
    conn.db.player.onDelete((_ctx, row) => this.session?.removePlayer(row.playerId));

    conn.db.npc.onInsert((_ctx, row) => this.session?.applyNpc(row));
    conn.db.npc.onUpdate((_ctx, _old, row) => this.session?.applyNpc(row));
    conn.db.npc.onDelete((_ctx, row) => this.session?.removeNpc(row.npcId));

    // Nur Updates: die initialen 65536 Kacheln kommen als Inserts und werden von loadWorld
    // gesammelt eingelesen; danach ändern sich Kacheln nur noch über den Karteneditor.
    conn.db.worldTile.onUpdate((_ctx, _old, row) => this.session?.applyTile(row));
  }
}

function subscribeNpcs(conn: DbConnection, mapId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(ctx.event ?? new Error("Subscription auf npc fehlgeschlagen")))
      .subscribe([tables.npc.where((row) => row.mapId.eq(mapId))]);
  });
}

function describeConnectError(error: Error): string {
  let message = `Verbindung zum Server fehlgeschlagen: ${error.message || error}`;
  if (location.protocol === "https:" && CONFIG.SERVER_URI.startsWith("ws:")) {
    message +=
      " - diese Seite läuft über HTTPS, der Server-URL ist aber ws:// " +
      `(${CONFIG.SERVER_URI}). Browser blockieren das als Mixed Content. ` +
      "Entweder einen wss://-Endpunkt per ?server=... angeben, oder die Seite " +
      "über http:// (localhost/LAN-IP) statt https:// öffnen.";
  }
  return message;
}
