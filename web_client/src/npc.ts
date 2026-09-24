// NPC_ART_NAMES/NPC_KATEGORIE_FARBEN must stay in sync with NpcArt/NpcKategorie in Lib.cs -
// same manual-sync caveat as world.ts's BIOM_FARBEN vs. the server's Biom enum. Shared
// between app.ts (play client) and editor.ts (map editor's NPC tool).
export const NPC_ART_NAMES = [
  "Hase", "Wolf", "Tiger",
  "Wanderer", "Einsiedler", "Räuber",
  "Fuchsgeist", "Kranich-Fee", "Berggeist",
];
export const NPC_KATEGORIE_NAMEN = ["Tiere", "Menschen", "Fabelwesen"];
export const NPC_KATEGORIE_FARBEN = ["#c98a3c", "#4090e0", "#a060e0"]; // Tiere, Menschen, Fabelwesen

// Kategorie -> [erste Art, letzte Art] im flachen NpcArt-Roster (siehe Lib.cs-Kommentar dort).
export const NPC_KATEGORIE_ARTEN: ReadonlyArray<readonly [number, number]> = [
  [0, 2], // Tiere: Hase, Wolf, Tiger
  [3, 5], // Menschen: Wanderer, Einsiedler, Raeuber
  [6, 8], // Fabelwesen: Fuchsgeist, Kranich-Fee, Berggeist
];
