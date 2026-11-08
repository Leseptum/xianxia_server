type Handler = (...args: unknown[]) => void;

/**
 * Minimaler typisierter Event-Emitter für die Netzwerkschicht. Bewusst nicht Phasers
 * EventEmitter, damit src/net/ (und seine Tests) Phaser-frei bleiben.
 */
export class Emitter<Events extends { [K in keyof Events]: unknown[] }> {
  private handlers = new Map<keyof Events, Set<Handler>>();

  /** Registriert einen Handler; Rückgabe ist die passende Abmelde-Funktion. */
  on<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    const handler = fn as unknown as Handler;
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Kopie: ein Handler darf sich während des Aufrufs selbst abmelden.
    for (const fn of [...set]) fn(...args);
  }
}
