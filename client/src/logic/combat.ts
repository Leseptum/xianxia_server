// Spiegelt NPC_ANGRIFF_REICHWEITE in Lib.cs (1 Kachel pro Achse = alle 8 Nachbarfelder).
// Nur UX (Button aktiv/inaktiv, Zielwahl) - die Reichweiten-/Kartenprüfung im
// Angreifen-Reducer bleibt die eigentliche Autorität, wie in web_client.
export const ANGRIFF_REICHWEITE = 1;

export interface Positioned {
  posX: number;
  posY: number;
}

/** Nächster NPC innerhalb der Angriffsreichweite (Tschebyschew), sonst null. */
export function nearestInRange<T extends Positioned>(
  x: number,
  y: number,
  candidates: Iterable<T>,
  range = ANGRIFF_REICHWEITE
): T | null {
  let nearest: T | null = null;
  let nearestDist = Infinity;
  for (const c of candidates) {
    const dist = Math.max(Math.abs(x - c.posX), Math.abs(y - c.posY));
    if (dist <= range && dist < nearestDist) {
      nearest = c;
      nearestDist = dist;
    }
  }
  return nearest;
}
