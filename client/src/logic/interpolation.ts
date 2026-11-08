import type { Point } from "./iso";

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Tschebyschew-Abstand (max. Achsenabstand) - passt zur Kachel-/Schrittlogik des Servers. */
export function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Glättet diskrete Positionsupdates (der Server liefert ganze Kacheln: Spieler im
 * STEP_INTERVAL_MS-Takt, NPCs alle 3 s) zu einer kontinuierlichen Bewegung im Gitterraum.
 *
 * Jedes neue Ziel wird ab der AKTUELL GEZEIGTEN Position linear über `durationMs` angelaufen -
 * kommt ein Update an, bevor das vorige Ziel erreicht ist, gibt es also keinen Sprung, sondern
 * die Bewegung biegt nahtlos zum neuen Ziel ab. Linear statt Easing, weil aufeinanderfolgende
 * Schritte eines laufenden Spielers sonst sichtbar ruckeln (Abbremsen/Anfahren pro Kachel).
 *
 * Bewusst ohne Snapshot-Puffer mit Render-Verzögerung (klassische Entity-Interpolation):
 * bei Kachel-Schritten mit bekanntem Takt bringt der keinen sichtbaren Gewinn, kostet aber
 * eine feste Zusatzlatenz.
 *
 * Zeitquelle ist egal (ms, monoton), solange setTarget und sample dieselbe verwenden.
 */
export class InterpolatedPosition {
  private fromX: number;
  private fromY: number;
  private toX: number;
  private toY: number;
  private startMs = 0;
  private durationMs = 0;

  constructor(x: number, y: number) {
    this.fromX = this.toX = x;
    this.fromY = this.toY = y;
  }

  get target(): Point {
    return { x: this.toX, y: this.toY };
  }

  /**
   * Setzt ein neues Ziel. Ist es weiter als `snapDistance` von der aktuell gezeigten Position
   * entfernt (Teleport, Editor-Verschiebung) oder ist durationMs <= 0, wird direkt versetzt.
   * Ein unverändertes Ziel (z. B. Player-Update, das nur Qi ändert) startet die laufende
   * Bewegung nicht neu.
   */
  setTarget(x: number, y: number, nowMs: number, durationMs: number, snapDistance = Infinity): void {
    if (x === this.toX && y === this.toY) return;
    const current = this.sample(nowMs);
    if (durationMs <= 0 || chebyshev(current, { x, y }) > snapDistance) {
      this.snapTo(x, y);
      return;
    }
    this.fromX = current.x;
    this.fromY = current.y;
    this.toX = x;
    this.toY = y;
    this.startMs = nowMs;
    this.durationMs = durationMs;
  }

  snapTo(x: number, y: number): void {
    this.fromX = this.toX = x;
    this.fromY = this.toY = y;
    this.durationMs = 0;
  }

  /** Gezeigte Position zum Zeitpunkt nowMs. */
  sample(nowMs: number): Point {
    const t = this.progress(nowMs);
    return { x: lerp(this.fromX, this.toX, t), y: lerp(this.fromY, this.toY, t) };
  }

  isMoving(nowMs: number): boolean {
    return this.progress(nowMs) < 1;
  }

  private progress(nowMs: number): number {
    if (this.durationMs <= 0) return 1;
    return Math.min(Math.max((nowMs - this.startMs) / this.durationMs, 0), 1);
  }
}
