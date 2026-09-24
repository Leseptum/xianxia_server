import { tables, type DbConnection } from "./module_bindings";
import type { Npc as NpcRow, Player as PlayerRow } from "./module_bindings/types";
import { connect } from "./connection";
import { sha256Hex } from "./sha256";
import { loadWorld, biomColorCss, BIOM, type WorldGrid, type Tile } from "./world";
import { NPC_ART_NAMES, NPC_KATEGORIE_NAMEN, NPC_KATEGORIE_FARBEN, NPC_KATEGORIE_ARTEN } from "./npc";

const BIOM_NAMES: Record<number, string> = {
  [BIOM.WASSER]: "Wasser",
  [BIOM.STRAND]: "Strand",
  [BIOM.EBENE]: "Ebene",
  [BIOM.WALD]: "Wald",
  [BIOM.BERG]: "Berg",
  [BIOM.SCHNEE]: "Schnee",
};

let connection: DbConnection | null = null;

let scale = 4; // pixel/Kachel, per Zoom verstellbar (siehe bindZoomControls/wheel-Handler)
const brush: Tile = { biom: BIOM.EBENE, kraeuter: 0, spiritStones: 0, holz: 0, erz: 0 };
let npcBrush = { kategorie: 0, art: 0 };

let currentMapId: number | null = null;
let currentTool: "terrain" | "npc" | "player" = "terrain";
let selectedNpcId: bigint | null = null;
let selectedPlayerId: bigint | null = null;
let draggingNpcId: bigint | null = null;
let draggingPlayerId: bigint | null = null;

let worldGrid: WorldGrid | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let painting = false;
let lastPaintedTile: { x: number; y: number } | null = null;

function setStatus(message: string): void {
  document.getElementById("editor-status")!.textContent = message;
}

function setLoginStatus(message: string, isError: boolean): void {
  const el = document.getElementById("login-status")!;
  el.textContent = message;
  el.style.color = isError ? "#e67878" : "#96e696";
}

/** Reads this tab's own editor_session row via the SDK's unique-index lookup on Owner. */
function ownSessionAuthorized(): boolean {
  const session = connection!.db.editorSession.Owner.find(connection!.identity!);
  return !!session && session.authorized;
}

function showError(message: string): void {
  const banner = document.getElementById("error-banner")!;
  banner.textContent = message;
  banner.classList.remove("hidden");
}

function clearError(): void {
  document.getElementById("error-banner")!.classList.add("hidden");
}

// ---- Terrain-Pinsel (unverändert vom ursprünglichen Editor) ----

function buildPalette(): void {
  const palette = document.getElementById("biom-palette")!;
  for (const biomKey of Object.keys(BIOM_NAMES)) {
    const biom = Number(biomKey);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "biom-swatch";
    button.textContent = BIOM_NAMES[biom];
    button.style.background = biomColorCss(biom);
    button.dataset.biom = String(biom);
    if (biom === brush.biom) button.classList.add("selected");
    button.addEventListener("click", () => {
      brush.biom = biom;
      for (const el of Array.from(palette.children)) el.classList.remove("selected");
      button.classList.add("selected");
    });
    palette.appendChild(button);
  }
}

function bindResourceInputs(): void {
  const bindings: Array<[string, keyof Tile]> = [
    ["brush-kraeuter", "kraeuter"],
    ["brush-spirit-stones", "spiritStones"],
    ["brush-holz", "holz"],
    ["brush-erz", "erz"],
  ];
  for (const [id, key] of bindings) {
    document.getElementById(id)!.addEventListener("input", (e) => {
      brush[key] = clamp255(Number((e.target as HTMLInputElement).value) || 0);
    });
  }
}

function clamp255(v: number): number {
  return Math.min(Math.max(Math.round(v), 0), 255);
}

// ---- NPC-Palette ----

function buildNpcPalette(): void {
  const palette = document.getElementById("npc-palette")!;
  for (let kategorie = 0; kategorie < NPC_KATEGORIE_NAMEN.length; kategorie++) {
    const [erste, letzte] = NPC_KATEGORIE_ARTEN[kategorie];
    for (let art = erste; art <= letzte; art++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "npc-swatch";
      button.textContent = NPC_ART_NAMES[art];
      button.style.background = NPC_KATEGORIE_FARBEN[kategorie];
      if (kategorie === npcBrush.kategorie && art === npcBrush.art) button.classList.add("selected");
      button.addEventListener("click", () => {
        npcBrush = { kategorie, art };
        for (const el of Array.from(palette.children)) el.classList.remove("selected");
        button.classList.add("selected");
      });
      palette.appendChild(button);
    }
  }
}

// ---- Werkzeug-Tabs ----

function bindToolTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tool-tab"));
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      currentTool = tab.dataset.tool as "terrain" | "npc" | "player";
      for (const t of tabs) t.classList.toggle("selected", t === tab);
      for (const panelTool of ["terrain", "npc", "player"]) {
        document.getElementById(`${panelTool}-panel`)!.classList.toggle("hidden", panelTool !== currentTool);
      }
      selectedNpcId = null;
      draggingNpcId = null;
      selectedPlayerId = null;
      draggingPlayerId = null;
      updateNpcPanel(null);
      updatePlayerPanel(null);
      render();
    });
  }
}

// ---- Karten-Auswahl/-Erstellung ----

function refreshMapList(): void {
  const select = document.getElementById("map-select") as HTMLSelectElement;
  select.innerHTML = "";
  const maps = Array.from(connection!.db.worldMeta.iter()).sort((a, b) => a.mapId - b.mapId);
  for (const m of maps) {
    const opt = document.createElement("option");
    opt.value = String(m.mapId);
    opt.textContent = `${m.name} (#${m.mapId})`;
    select.appendChild(opt);
  }
  if (currentMapId !== null) select.value = String(currentMapId);
}

function subscribeMapList(): Promise<void> {
  return new Promise((resolve, reject) => {
    connection!
      .subscriptionBuilder()
      .onApplied(() => {
        refreshMapList();
        resolve();
      })
      .onError((ctx) => reject(ctx.event ?? new Error("Subscription auf world_meta fehlgeschlagen")))
      .subscribe([tables.worldMeta]);
  });
}

function subscribeEntities(mapId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    connection!
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(ctx.event ?? new Error("Subscription auf npc/player fehlgeschlagen")))
      .subscribe([
        tables.npc.where((row) => row.mapId.eq(mapId)),
        tables.player.where((row) => row.mapId.eq(mapId)),
      ]);
  });
}

async function selectMap(mapId: number): Promise<void> {
  currentMapId = mapId;
  selectedNpcId = null;
  draggingNpcId = null;
  selectedPlayerId = null;
  draggingPlayerId = null;
  updateNpcPanel(null);
  updatePlayerPanel(null);

  setStatus("Lade Karte...");
  try {
    worldGrid = await loadWorld(connection!, mapId);
    await subscribeEntities(mapId);
  } catch (exc) {
    setStatus(`Fehler: ${exc instanceof Error ? exc.message : String(exc)}`);
    return;
  }

  canvas!.width = worldGrid.breite * scale;
  canvas!.height = worldGrid.hoehe * scale;
  setStatus(`Karte geladen (${worldGrid.breite}x${worldGrid.hoehe}).`);
  refreshMapList();
  render();
}

function bindMapControls(): void {
  document.getElementById("map-select")!.addEventListener("change", (e) => {
    const mapId = Number((e.target as HTMLSelectElement).value);
    if (!Number.isNaN(mapId)) selectMap(mapId);
  });

  document.getElementById("set-standard-button")!.addEventListener("click", async () => {
    if (currentMapId === null) return;
    try {
      await connection!.reducers.karteAlsStandardSetzen({ mapId: currentMapId });
      setStatus(`Karte #${currentMapId} ist jetzt Standard für neue Registrierungen.`);
      clearError();
    } catch (exc) {
      showError(exc instanceof Error ? exc.message : String(exc));
    }
  });

  document.getElementById("create-map-button")!.addEventListener("click", async () => {
    const name = (document.getElementById("new-map-name") as HTMLInputElement).value.trim();
    const seed = Number((document.getElementById("new-map-seed") as HTMLInputElement).value);
    const wasserAnteil = Number((document.getElementById("new-map-wasser") as HTMLInputElement).value);
    const skala = Number((document.getElementById("new-map-skala") as HTMLInputElement).value);
    if (!name) {
      showError("Name der neuen Karte darf nicht leer sein.");
      return;
    }

    const button = document.getElementById("create-map-button") as HTMLButtonElement;
    button.disabled = true;
    setStatus(`Erstelle Karte "${name}"... (kann einige Sekunden dauern)`);
    try {
      await connection!.reducers.karteErstellen({ name, seed, wasserAnteil, skala });
      // Der Reducer-Call löst erst nach vollständiger Weltgenerierung auf (siehe Lib.cs) -
      // die neue world_meta-Zeile ist an diesem Punkt bereits im lokalen Cache.
      const created = Array.from(connection!.db.worldMeta.iter()).find((m) => m.name === name);
      if (created) await selectMap(created.mapId);
      clearError();
    } catch (exc) {
      showError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      button.disabled = false;
    }
  });
}

// ---- Zoom ----

function clampScale(s: number): number {
  return Math.min(Math.max(s, 1), 16);
}

function setScale(newScale: number): void {
  scale = clampScale(newScale);
  if (!worldGrid || !canvas) return;
  canvas.width = worldGrid.breite * scale;
  canvas.height = worldGrid.hoehe * scale;
  render();
}

function bindZoomControls(): void {
  document.getElementById("zoom-in-button")!.addEventListener("click", () => setScale(scale + 1));
  document.getElementById("zoom-out-button")!.addEventListener("click", () => setScale(scale - 1));
}

// ---- Rendering ----

function render(): void {
  if (!worldGrid || !ctx || !canvas || currentMapId === null) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    worldGrid.minimapCanvas,
    0,
    0,
    worldGrid.breite,
    worldGrid.hoehe,
    0,
    0,
    canvas.width,
    canvas.height
  );
  drawNpcs();
  drawPlayers();
}

// UX-only helper for onInsert/onUpdate/onDelete callbacks that may fire before a map
// is fully loaded (e.g. right after connecting).
function renderIfReady(): void {
  if (worldGrid && ctx && canvas && currentMapId !== null) render();
}

function drawNpcs(): void {
  for (const npc of connection!.db.npc.iter()) {
    if (npc.mapId !== currentMapId) continue;
    const px = npc.posX * scale + scale / 2;
    const py = npc.posY * scale + scale / 2;
    ctx!.beginPath();
    ctx!.arc(px, py, Math.max(scale / 2 - 1, 2), 0, 2 * Math.PI);
    ctx!.fillStyle = NPC_KATEGORIE_FARBEN[npc.kategorie];
    ctx!.fill();
    ctx!.lineWidth = npc.npcId === selectedNpcId ? 2 : 1;
    ctx!.strokeStyle = npc.npcId === selectedNpcId ? "#fff" : "#000";
    ctx!.stroke();
  }
}

function drawPlayers(): void {
  for (const player of connection!.db.player.iter()) {
    if (player.mapId !== currentMapId) continue;
    const px = player.posX * scale + scale / 2;
    const py = player.posY * scale + scale / 2;
    ctx!.beginPath();
    ctx!.arc(px, py, Math.max(scale / 2 - 1, 2), 0, 2 * Math.PI);
    ctx!.fillStyle = "#c850dc";
    ctx!.fill();
    ctx!.lineWidth = player.playerId === selectedPlayerId ? 2 : 1;
    ctx!.strokeStyle = player.playerId === selectedPlayerId ? "#fff" : "#000";
    ctx!.stroke();
  }
}

// ---- Auswahl-Panels (NPC/Spieler) ----

function updateNpcPanel(npc: NpcRow | null): void {
  const info = document.getElementById("npc-selected-info")!;
  const deleteButton = document.getElementById("npc-delete-button") as HTMLButtonElement;
  if (!npc) {
    info.textContent = "Kein NPC ausgewählt.";
    deleteButton.disabled = true;
    return;
  }
  info.textContent = `${NPC_ART_NAMES[npc.art]} (#${npc.npcId}) - HP ${npc.hp}/${npc.hpMaximum} bei (${npc.posX}, ${npc.posY})`;
  deleteButton.disabled = false;
}

function updatePlayerPanel(player: PlayerRow | null): void {
  const info = document.getElementById("player-selected-info")!;
  const deleteButton = document.getElementById("player-delete-button") as HTMLButtonElement;
  if (!player) {
    info.textContent = "Kein Spieler ausgewählt.";
    deleteButton.disabled = true;
    return;
  }
  info.textContent = `${player.name} (#${player.playerId}) - Stufe ${player.stufe} bei (${Math.floor(player.posX)}, ${Math.floor(player.posY)})`;
  deleteButton.disabled = false;
}

function bindSelectionButtons(): void {
  document.getElementById("npc-delete-button")!.addEventListener("click", () => {
    if (selectedNpcId === null) return;
    connection!.reducers
      .npcLoeschen({ npcId: selectedNpcId })
      .then(clearError)
      .catch((exc) => showError(exc instanceof Error ? exc.message : String(exc)));
    selectedNpcId = null;
    draggingNpcId = null;
    updateNpcPanel(null);
  });
  document.getElementById("player-delete-button")!.addEventListener("click", () => {
    if (selectedPlayerId === null) return;
    connection!.reducers
      .spielerLoeschen({ playerId: selectedPlayerId })
      .then(clearError)
      .catch((exc) => showError(exc instanceof Error ? exc.message : String(exc)));
    selectedPlayerId = null;
    draggingPlayerId = null;
    updatePlayerPanel(null);
  });
}

// ---- Kachel-/Entitäts-Lookup ----

function findNpcAt(x: number, y: number): NpcRow | undefined {
  if (currentMapId === null) return undefined;
  for (const row of connection!.db.npc.iter()) {
    if (row.mapId === currentMapId && row.posX === x && row.posY === y) return row;
  }
  return undefined;
}

function findPlayerAt(x: number, y: number): PlayerRow | undefined {
  if (currentMapId === null) return undefined;
  for (const row of connection!.db.player.iter()) {
    if (row.mapId === currentMapId && Math.floor(row.posX) === x && Math.floor(row.posY) === y) return row;
  }
  return undefined;
}

function tileFromEvent(e: MouseEvent): { x: number; y: number } | null {
  const rect = canvas!.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / scale);
  const y = Math.floor((e.clientY - rect.top) / scale);
  if (x < 0 || y < 0 || x >= worldGrid!.breite || y >= worldGrid!.hoehe) return null;
  return { x, y };
}

// ---- Pointer-Handling (pro Werkzeug) ----

async function paintTerrain(tile: { x: number; y: number }): Promise<void> {
  if (currentMapId === null) return;
  try {
    await connection!.reducers.editTile({
      mapId: currentMapId,
      x: tile.x,
      y: tile.y,
      biomTyp: brush.biom,
      kraeuterMenge: brush.kraeuter,
      spiritStones: brush.spiritStones,
      holz: brush.holz,
      erz: brush.erz,
    });
    worldGrid!.setTile(tile.x, tile.y, { ...brush });
    render();
    clearError();
  } catch (exc) {
    showError(exc instanceof Error ? exc.message : String(exc));
  }
}

function handleNpcPointer(tile: { x: number; y: number }): void {
  if (currentMapId === null) return;
  if (draggingNpcId !== null) {
    connection!.reducers
      .npcVerschieben({ npcId: draggingNpcId, x: tile.x, y: tile.y })
      .then(clearError)
      .catch((exc) => showError(exc instanceof Error ? exc.message : String(exc)));
    return;
  }

  const existing = findNpcAt(tile.x, tile.y);
  if (existing) {
    selectedNpcId = existing.npcId;
    draggingNpcId = existing.npcId;
    updateNpcPanel(existing);
    render();
    return;
  }

  connection!.reducers
    .npcErstellen({ mapId: currentMapId, kategorie: npcBrush.kategorie, art: npcBrush.art, x: tile.x, y: tile.y })
    .then(clearError)
    .catch((exc) => showError(exc instanceof Error ? exc.message : String(exc)));
}

function handlePlayerPointer(tile: { x: number; y: number }): void {
  if (draggingPlayerId !== null) {
    connection!.reducers
      .spielerVerschieben({ playerId: draggingPlayerId, x: tile.x, y: tile.y })
      .then(clearError)
      .catch((exc) => showError(exc instanceof Error ? exc.message : String(exc)));
    return;
  }

  const existing = findPlayerAt(tile.x, tile.y);
  if (existing) {
    selectedPlayerId = existing.playerId;
    draggingPlayerId = existing.playerId;
    updatePlayerPanel(existing);
    render();
  }
  // Klick auf leere Kachel im Spieler-Werkzeug tut nichts - Spieler entstehen nur über Register.
}

function updateHover(e: MouseEvent): void {
  const tile = tileFromEvent(e);
  if (!tile) return;
  let text = `Kachel: (${tile.x}, ${tile.y})`;

  const t = worldGrid!.getTile(tile.x, tile.y);
  if (t) {
    text += ` - ${BIOM_NAMES[t.biom]} | Kräuter ${t.kraeuter}, Spirit Stones ${t.spiritStones}, Holz ${t.holz}, Erz ${t.erz}`;
  }
  const npc = findNpcAt(tile.x, tile.y);
  if (npc) text += ` | NPC: ${NPC_ART_NAMES[npc.art]} (${npc.hp}/${npc.hpMaximum})`;
  const player = findPlayerAt(tile.x, tile.y);
  if (player) text += ` | Spieler: ${player.name} (Stufe ${player.stufe})`;

  document.getElementById("editor-hover")!.textContent = text;
}

function handlePointerAt(e: MouseEvent): void {
  const tile = tileFromEvent(e);
  if (!tile) return;
  if (lastPaintedTile && lastPaintedTile.x === tile.x && lastPaintedTile.y === tile.y) return;
  lastPaintedTile = tile;

  if (currentTool === "terrain") paintTerrain(tile);
  else if (currentTool === "npc") handleNpcPointer(tile);
  else handlePlayerPointer(tile);
}

function bindCanvasEvents(): void {
  canvas!.addEventListener("mousedown", (e) => {
    painting = true;
    lastPaintedTile = null;
    handlePointerAt(e);
  });
  window.addEventListener("mouseup", () => {
    painting = false;
    lastPaintedTile = null;
    draggingNpcId = null;
    draggingPlayerId = null;
  });
  canvas!.addEventListener("mousemove", (e) => {
    updateHover(e);
    if (painting) handlePointerAt(e);
  });
  canvas!.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      setScale(scale + (e.deltaY < 0 ? 1 : -1));
    },
    { passive: false }
  );
}

// ---- Boot ----

async function startEditor(): Promise<void> {
  document.getElementById("login-screen")!.classList.add("hidden");
  document.getElementById("editor-screen")!.classList.remove("hidden");

  canvas = document.getElementById("editor-canvas") as HTMLCanvasElement;
  ctx = canvas.getContext("2d")!;

  buildPalette();
  bindResourceInputs();
  buildNpcPalette();
  bindToolTabs();
  bindZoomControls();
  bindCanvasEvents();
  bindMapControls();
  bindSelectionButtons();

  try {
    await subscribeMapList();
  } catch (exc) {
    setStatus(`Fehler: ${exc instanceof Error ? exc.message : String(exc)}`);
    return;
  }

  const firstMap = Array.from(connection!.db.worldMeta.iter()).sort((a, b) => a.mapId - b.mapId)[0];
  if (!firstMap) {
    setStatus("Keine Karte vorhanden.");
    return;
  }
  await selectMap(firstMap.mapId);
}

async function attemptUnlock(): Promise<void> {
  const passwordInput = document.getElementById("editor-password-input") as HTMLInputElement;
  const unlockButton = document.getElementById("editor-unlock-button") as HTMLButtonElement;
  const password = passwordInput.value;
  if (!password) return;

  unlockButton.disabled = true;
  setLoginStatus("Prüfe Passwort...", false);
  try {
    const passwordHash = sha256Hex(password);
    await connection!.reducers.editorLogin({ passwordHash });
    if (ownSessionAuthorized()) {
      await startEditor();
    } else {
      setLoginStatus("Falsches Passwort.", true);
    }
  } catch (exc) {
    setLoginStatus(exc instanceof Error ? exc.message : String(exc), true);
  } finally {
    unlockButton.disabled = false;
  }
}

function boot(): void {
  connection = connect(
    (conn) => {
      connection = conn;

      conn.db.worldMeta.onInsert(() => refreshMapList());
      conn.db.worldMeta.onUpdate(() => refreshMapList());

      conn.db.npc.onInsert(() => renderIfReady());
      conn.db.npc.onUpdate((_ctx, _old, row) => {
        renderIfReady();
        if (row.npcId === selectedNpcId) updateNpcPanel(row);
      });
      conn.db.npc.onDelete((_ctx, row) => {
        renderIfReady();
        if (row.npcId === selectedNpcId) {
          selectedNpcId = null;
          draggingNpcId = null;
          updateNpcPanel(null);
        }
      });

      conn.db.player.onInsert(() => renderIfReady());
      conn.db.player.onUpdate((_ctx, _old, row) => {
        renderIfReady();
        if (row.playerId === selectedPlayerId) updatePlayerPanel(row);
      });
      conn.db.player.onDelete((_ctx, row) => {
        renderIfReady();
        if (row.playerId === selectedPlayerId) {
          selectedPlayerId = null;
          draggingPlayerId = null;
          updatePlayerPanel(null);
        }
      });

      conn
        .subscriptionBuilder()
        .onApplied(() => {
          // Same tab/Identity already unlocked the editor earlier this session - skip the prompt.
          if (ownSessionAuthorized()) {
            startEditor();
            return;
          }
          document.getElementById("login-form")!.addEventListener("submit", (e) => {
            e.preventDefault();
            attemptUnlock();
          });
        })
        .onError((ctx) => {
          setLoginStatus(
            `Konnte nicht mit dem Server synchronisieren: ${ctx.event?.message ?? "unbekannter Fehler"}`,
            true
          );
        })
        .subscribe([tables.editorSession]);
    },
    (error) => setLoginStatus(error.message || String(error), true)
  );
}

boot();
