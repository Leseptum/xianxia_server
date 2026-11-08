import { BIOM } from "../world";
import type { Point } from "./iso";

export interface Direction {
  dx: number;
  dy: number;
}

export interface DirectionKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Taste -> Gitterrichtung, identisch zum web_client (W/↑ = y-1, S/↓ = y+1, A/← = x-1,
 * D/→ = x+1; else-if-Kette, also nur eine Achse pro Schritt, keine Diagonalen). Durch die
 * Iso-Projektion (logic/iso.ts) erscheinen diese Gitterachsen auf dem Bildschirm diagonal:
 * W = rechts oben, D = rechts unten, S = links unten, A = links oben. Dieselbe Taste bewegt in
 * beiden Clients also in dieselbe Gitter-/Himmelsrichtung.
 */
export function directionFromKeys(keys: DirectionKeys): Direction | null {
  if (keys.left) return { dx: -1, dy: 0 };
  if (keys.right) return { dx: 1, dy: 0 };
  if (keys.up) return { dx: 0, dy: -1 };
  if (keys.down) return { dx: 0, dy: 1 };
  return null;
}

/** Gleiche Regel wie web_client/isWalkable und Lib.cs/IstBegehbar: Wasser und Berg blockieren. */
export function isWalkableBiom(biom: number | null): boolean {
  return biom !== null && biom !== BIOM.WASSER && biom !== BIOM.BERG;
}

/**
 * Eigene Spielerposition mit clientseitiger Vorhersage und serverseitiger Bestätigung.
 *
 * Ein Schritt wird lokal sofort übernommen (keine Eingabelatenz) und per UpdatePosition an den
 * Server geschickt; der Server bleibt die Autorität: Sobald KEIN eigener Schritt mehr unterwegs
 * ist, wird die Vorhersage mit der Serverzeile abgeglichen und bei Abweichung korrigiert
 * (Server hat den Schritt verworfen, Editor hat den Spieler versetzt, ...).
 *
 * Warum "erst abgleichen, wenn nichts mehr unterwegs ist": UpdatePosition trägt keine
 * Sequenznummer, und eine verworfene Bewegung erzeugt serverseitig gar kein Row-Update. Solange
 * noch eigene Schritte offen sind, ist die Serverzeile daher zwangsläufig "hinter" der
 * Vorhersage und kein Fehler. Das SDK löst Reducer-Promises erst NACH dem Anwenden der
 * zugehörigen Row-Diffs auf, d. h. nach dem letzten settle() ist der Cache-Stand verbindlich.
 */
export class PredictedPosition {
  x: number;
  y: number;
  private inFlight = 0;

  constructor(x: number, y: number) {
    this.x = Math.floor(x);
    this.y = Math.floor(y);
  }

  get pendingSteps(): number {
    return this.inFlight;
  }

  /**
   * Prüft einen Schritt (Kartenrand, Begehbarkeit des Zielfelds - wie web_client) und übernimmt
   * ihn bei Erfolg lokal. Rückgabe: neues Zielfeld (das an UpdatePosition geht) oder null.
   */
  tryStep(
    dir: Direction,
    isWalkable: (x: number, y: number) => boolean,
    mapWidth: number,
    mapHeight: number
  ): Point | null {
    const nx = Math.min(Math.max(this.x + dir.dx, 0), mapWidth - 1);
    const ny = Math.min(Math.max(this.y + dir.dy, 0), mapHeight - 1);
    if (nx === this.x && ny === this.y) return null;
    if (!isWalkable(nx, ny)) return null;
    this.x = nx;
    this.y = ny;
    this.inFlight++;
    return { x: nx, y: ny };
  }

  /**
   * Ein gesendeter Schritt ist abgeschlossen (Reducer-Promise erfüllt ODER abgelehnt).
   * `authoritative` = Serverposition laut lokalem Cache danach (null, falls keine Zeile).
   * Rückgabe: true, wenn die Vorhersage dabei korrigiert wurde.
   */
  settle(authoritative: Point | null): boolean {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.inFlight > 0 || authoritative === null) return false;
    return this.adopt(authoritative);
  }

  /**
   * Row-Update vom Server. Wird ignoriert, solange eigene Schritte unterwegs sind (das sind
   * dann die Bestätigungen genau dieser Schritte, siehe Klassenkommentar); sonst übernommen,
   * z. B. nach einer Editor-Verschiebung. Rückgabe: true bei Positionsänderung.
   */
  serverUpdate(pos: Point): boolean {
    if (this.inFlight > 0) return false;
    return this.adopt(pos);
  }

  private adopt(pos: Point): boolean {
    // Floor wie web_client - der Server speichert ganze Kacheln als float, prüft mit (int).
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    if (x === this.x && y === this.y) return false;
    this.x = x;
    this.y = y;
    return true;
  }
}
