import { tables, type DbConnection } from "./module_bindings";
import type { Player as PlayerRow } from "./module_bindings/types";
import { connect, clearCachedIdentity } from "./connection";
import { sha256Hex } from "./sha256";
import { loadWorld, biomColorCss, BIOM, type WorldGrid } from "./world";
import { CONFIG } from "./config";

let connection: DbConnection | null = null;

const screens = {
  login: document.getElementById("login-screen")!,
  loading: document.getElementById("loading-screen")!,
  game: document.getElementById("game-screen")!,
};

function showScreen(name: keyof typeof screens): void {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle("hidden", key !== name);
  }
  // The game screen fills the viewport and scrolls nowhere on its own; letting the
  // page itself scroll just triggers mobile-browser toolbar show/hide, which
  // thrashes resizeCanvas() and shows up as canvas tearing.
  document.body.classList.toggle("no-scroll", name === "game");
}

function setLoginStatus(message: string, isError: boolean): void {
  const el = document.getElementById("login-status")!;
  el.textContent = message;
  el.style.color = isError ? "#e67878" : "#96e696";
}

function setLoginBusy(busy: boolean): void {
  (document.getElementById("register-button") as HTMLButtonElement).disabled = busy;
  (document.getElementById("login-button") as HTMLButtonElement).disabled = busy;
  (document.getElementById("name-input") as HTMLInputElement).disabled = busy;
  (document.getElementById("password-input") as HTMLInputElement).disabled = busy;
}

function findPlayerByName(name: string): PlayerRow | undefined {
  for (const row of connection!.db.player.iter()) {
    if (row.name === name) return row;
  }
  return undefined;
}

async function doRegister(name: string, password: string): Promise<PlayerRow> {
  // Register silently no-ops server-side if the name is already taken (see Lib.cs) - without
  // this pre-check, the row lookup below would then find the *other* player's existing row
  // (the local cache isn't scoped to our own identity) and mistake it for a successful signup.
  if (findPlayerByName(name)) {
    throw new Error(`Name "${name}" ist bereits vergeben. Bitte einen anderen Namen wählen.`);
  }

  const passwordHash = sha256Hex(password);
  await connection!.reducers.register({ name, passwordHash });

  // By the time the reducer call above resolves, any row it inserted/updated has
  // already been applied to the local subscription cache (same server message) -
  // no polling/retry needed to see the new row.
  const row = findPlayerByName(name);
  if (!row) {
    throw new Error(
      "Registrierung hat kein Spielerobjekt erzeugt. Diese Tab-Identity ist vermutlich schon " +
        "mit einem anderen Namen registriert (der Server erlaubt nur einen Spieler pro " +
        "Identity) - unten 'Logout' klicken und erneut versuchen, oder einen neuen Tab öffnen."
    );
  }
  return row;
}

async function doLogin(name: string, password: string): Promise<PlayerRow> {
  const row = findPlayerByName(name);
  if (!row) throw new Error("Login fehlgeschlagen: Spieler existiert nicht.");

  const passwordHash = sha256Hex(password);
  await connection!.reducers.login({ name, passwordHash });

  const attempt = connection!.db.loginAttempt.PlayerId.find(row.playerId);
  if (!attempt || !attempt.success) throw new Error("Login fehlgeschlagen: Name/Passwort falsch.");
  return row;
}

async function handleAuth(action: (name: string, password: string) => Promise<PlayerRow>): Promise<void> {
  const name = (document.getElementById("name-input") as HTMLInputElement).value.trim();
  const password = (document.getElementById("password-input") as HTMLInputElement).value;
  if (!name || !password) {
    setLoginStatus("Name und Passwort duerfen nicht leer sein.", true);
    return;
  }

  setLoginBusy(true);
  setLoginStatus("Verbinde mit Server...", false);
  try {
    const row = await action(name, password);
    setLoginStatus(`Willkommen, ${row.name}!`, false);
    await startGame(row);
  } catch (exc) {
    setLoginStatus(exc instanceof Error ? exc.message : String(exc), true);
  } finally {
    setLoginBusy(false);
  }
}

async function startGame(playerRow: PlayerRow): Promise<void> {
  showScreen("loading");
  const loadingStatus = document.getElementById("loading-status")!;
  try {
    const worldGrid = await loadWorld(connection!);
    loadingStatus.textContent = "Fertig.";
    showScreen("game");
    initGame(playerRow, worldGrid);
  } catch (exc) {
    loadingStatus.textContent = `Fehler: ${exc instanceof Error ? exc.message : String(exc)}`;
  }
}

// ---- Game state ----

interface PlayerState {
  playerId: bigint;
  name: string;
  qi: bigint;
  qiMaximum: bigint;
  stufe: number;
  posX: number;
  posY: number;
}

export function toPlayerState(row: PlayerRow): PlayerState {
  return {
    playerId: row.playerId,
    name: row.name,
    qi: row.qi,
    qiMaximum: row.qiMaximum,
    stufe: row.stufe,
    posX: row.posX,
    posY: row.posY,
  };
}

interface GameState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  worldGrid: WorldGrid;
  localPlayerId: bigint;
  players: Map<bigint, PlayerState>;
  posX: number;
  posY: number;
  keys: Set<string>;
  viewMode: "follow" | "map";
  lastStepAt: number;
  lastFrameAt: number;
  errorMessage: string | null;
  hudHeight: number;
}

let game: GameState | null = null;

function initGame(localPlayerRow: PlayerRow, worldGrid: WorldGrid): void {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;

  const players = new Map<bigint, PlayerState>();
  for (const row of connection!.db.player.iter()) {
    players.set(row.playerId, toPlayerState(row));
  }

  game = {
    canvas,
    ctx,
    worldGrid,
    localPlayerId: localPlayerRow.playerId,
    players,
    posX: Math.floor(localPlayerRow.posX),
    posY: Math.floor(localPlayerRow.posY),
    keys: new Set(),
    viewMode: "follow",
    lastStepAt: 0,
    lastFrameAt: performance.now(),
    errorMessage: null,
    hudHeight: CONFIG.HUD_HEIGHT,
  };

  window.addEventListener("keydown", (e) => {
    game!.keys.add(e.key.toLowerCase());
    if (e.key.toLowerCase() === "m") {
      game!.viewMode = game!.viewMode === "follow" ? "map" : "follow";
    }
  });
  window.addEventListener("keyup", (e) => game!.keys.delete(e.key.toLowerCase()));

  document.getElementById("collect-button")!.addEventListener("click", () => {
    connection!.reducers
      .qiSammeln({})
      .then(clearError)
      .catch((exc) => showError(exc instanceof Error ? exc.message : String(exc)));
  });
  document.getElementById("breakthrough-button")!.addEventListener("click", () => {
    connection!.reducers
      .durchbruch({})
      .then(clearError)
      .catch((exc) => showError(exc instanceof Error ? exc.message : String(exc)));
  });
  document.getElementById("logout-button-game")!.addEventListener("click", logout);
  document.getElementById("map-toggle-button")!.addEventListener("click", () => {
    game!.viewMode = game!.viewMode === "follow" ? "map" : "follow";
  });
  document.getElementById("drawer-handle")!.addEventListener("click", () => {
    document.getElementById("game-screen")!.classList.toggle("drawer-open");
  });
  bindTouchDpad();

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", resizeCanvas);

  updateHud();
  requestAnimationFrame(frame);
}

// On-screen D-pad: presses/releases just add/remove the same direction keys the
// keydown/keyup handlers above use, so update()'s movement logic needs no changes.
function bindTouchDpad(): void {
  const dirKeys: Record<string, string> = { up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright" };
  for (const [dir, key] of Object.entries(dirKeys)) {
    const btn = document.getElementById(`dpad-${dir}`)!;
    const press = (e: Event) => { e.preventDefault(); game!.keys.add(key); };
    const release = (e: Event) => { e.preventDefault(); game!.keys.delete(key); };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("pointerleave", release);
  }
}

// Matches the canvas's backing-store resolution to its actual on-screen size (the
// CSS/media-query rules resize #game-screen; without this the canvas would stay at
// whatever width/height it last had, blurry-stretched by the browser). Also re-measures
// #hud's real rendered height, since the mobile layout stacks it to a variable height
// instead of the fixed desktop 90px bar.
function resizeCanvas(): void {
  const gameScreen = document.getElementById("game-screen")!;
  const rect = gameScreen.getBoundingClientRect();
  game!.canvas.width = Math.round(rect.width);
  game!.canvas.height = Math.round(rect.height);
  game!.hudHeight = document.getElementById("hud")!.getBoundingClientRect().height || CONFIG.HUD_HEIGHT;
  // Exposed so #touch-dpad/#logout-button-game (style.css) can position themselves
  // just above the HUD without hardcoding its (variable, stacked-on-mobile) height.
  (gameScreen as HTMLElement).style.setProperty("--hud-height", `${game!.hudHeight}px`);
}

function showError(message: string): void {
  game!.errorMessage = message;
  const banner = document.getElementById("error-banner")!;
  banner.textContent = message;
  banner.classList.remove("hidden");
}

function clearError(): void {
  if (!game) return;
  game.errorMessage = null;
  document.getElementById("error-banner")!.classList.add("hidden");
}

function frame(now: number): void {
  const dt = Math.min((now - game!.lastFrameAt) / 1000, 0.1);
  game!.lastFrameAt = now;

  update(dt, now);
  render();

  requestAnimationFrame(frame);
}

function update(_dt: number, now: number): void {
  // Grid movement: one tile per step, 4 directions only (no diagonals - an
  // else-if chain so only one axis is ever chosen), throttled to
  // STEP_INTERVAL_MS while a key is held.
  if (now - game!.lastStepAt >= CONFIG.STEP_INTERVAL_MS) {
    let dx = 0;
    let dy = 0;
    if (game!.keys.has("a") || game!.keys.has("arrowleft")) dx = -1;
    else if (game!.keys.has("d") || game!.keys.has("arrowright")) dx = 1;
    else if (game!.keys.has("w") || game!.keys.has("arrowup")) dy = -1;
    else if (game!.keys.has("s") || game!.keys.has("arrowdown")) dy = 1;

    if (dx !== 0 || dy !== 0) {
      const nextX = clamp(game!.posX + dx, 0, game!.worldGrid.breite - 1);
      const nextY = clamp(game!.posY + dy, 0, game!.worldGrid.hoehe - 1);
      if (isWalkable(nextX, nextY)) {
        game!.posX = nextX;
        game!.posY = nextY;
        game!.lastStepAt = now;
        connection!.reducers
          .updatePosition({ x: game!.posX, y: game!.posY })
          .then(clearError)
          .catch((exc) => showError(exc instanceof Error ? exc.message : String(exc)));
      }
    }
  }

  updateHud();
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function isWalkable(x: number, y: number): boolean {
  const biom = game!.worldGrid.getBiom(Math.floor(x), Math.floor(y));
  return biom !== null && biom !== BIOM.WASSER && biom !== BIOM.BERG;
}

function updateHud(): void {
  const local = game!.players.get(game!.localPlayerId);
  const breakthroughButton = document.getElementById("breakthrough-button") as HTMLButtonElement;
  if (!local) {
    document.getElementById("hud-name")!.textContent = "Warte auf Server-Daten...";
    document.getElementById("qi-text")!.textContent = "";
    (document.getElementById("qi-bar-fill") as HTMLElement).style.width = "0%";
    breakthroughButton.disabled = true;
    return;
  }
  document.getElementById("hud-name")!.textContent = `${local.name} - Stufe ${local.stufe}`;
  document.getElementById("qi-text")!.textContent = `Qi: ${local.qi} / ${local.qiMaximum}`;
  const ratio = local.qiMaximum === 0n ? 0 : Math.min(Number(local.qi) / Number(local.qiMaximum), 1);
  (document.getElementById("qi-bar-fill") as HTMLElement).style.width = `${ratio * 100}%`;
  breakthroughButton.disabled = local.qi < local.qiMaximum;
}

function cameraOrigin() {
  const canvas = game!.canvas;
  const visibleCols = canvas.width / CONFIG.TILE_SIZE + 2;
  const visibleRows = (canvas.height - game!.hudHeight) / CONFIG.TILE_SIZE + 2;
  return {
    camX: game!.posX - visibleCols / 2,
    camY: game!.posY - visibleRows / 2,
    cols: visibleCols,
    rows: visibleRows,
  };
}

function render(): void {
  const { ctx, canvas } = game!;
  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (game!.viewMode === "map") {
    drawFullMap();
  } else {
    drawWorld();
    drawPlayers();
  }
}

function drawWorld(): void {
  const { ctx, worldGrid } = game!;
  const { camX, camY, cols, rows } = cameraOrigin();
  const startX = Math.floor(camX);
  const startY = Math.floor(camY);

  for (let j = 0; j <= rows; j++) {
    const worldY = startY + j;
    for (let i = 0; i <= cols; i++) {
      const worldX = startX + i;
      const biom = worldGrid.getBiom(worldX, worldY);
      if (biom === null) continue;
      const screenX = (worldX - camX) * CONFIG.TILE_SIZE;
      const screenY = (worldY - camY) * CONFIG.TILE_SIZE;
      ctx.fillStyle = biomColorCss(biom);
      ctx.fillRect(screenX, screenY, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
    }
  }
}

function drawPlayers(): void {
  const { ctx } = game!;
  const { camX, camY } = cameraOrigin();

  for (const [playerId, player] of game!.players) {
    const isLocal = playerId === game!.localPlayerId;
    const worldX = isLocal ? game!.posX : player.posX;
    const worldY = isLocal ? game!.posY : player.posY;

    const screenX = (worldX - camX) * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    const screenY = (worldY - camY) * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;

    ctx.beginPath();
    ctx.arc(screenX, screenY, CONFIG.TILE_SIZE / 2 - 2, 0, 2 * Math.PI);
    ctx.fillStyle = isLocal ? "#ffd23c" : "#c850dc";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000";
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(player.name, screenX, screenY - CONFIG.TILE_SIZE / 2 - 4);
  }
}

function mapLayout() {
  const canvas = game!.canvas;
  const worldGrid = game!.worldGrid;
  const margin = CONFIG.MAP_MARGIN;
  const areaW = canvas.width - 2 * margin;
  const areaH = canvas.height - game!.hudHeight - 2 * margin;
  const scale = Math.min(areaW / worldGrid.breite, areaH / worldGrid.hoehe);
  const drawW = worldGrid.breite * scale;
  const drawH = worldGrid.hoehe * scale;
  const originX = margin + (areaW - drawW) / 2;
  const originY = margin + (areaH - drawH) / 2;
  return { scale, drawW, drawH, originX, originY };
}

function drawFullMap(): void {
  const { ctx, worldGrid } = game!;
  const { scale, drawW, drawH, originX, originY } = mapLayout();

  ctx.drawImage(worldGrid.minimapCanvas, originX, originY, drawW, drawH);
  ctx.strokeStyle = "#50505a";
  ctx.strokeRect(originX, originY, drawW, drawH);

  for (const [playerId, player] of game!.players) {
    const isLocal = playerId === game!.localPlayerId;
    const worldX = isLocal ? game!.posX : player.posX;
    const worldY = isLocal ? game!.posY : player.posY;
    const px = originX + worldX * scale;
    const py = originY + worldY * scale;

    ctx.beginPath();
    ctx.arc(px, py, isLocal ? 4 : 3, 0, 2 * Math.PI);
    ctx.fillStyle = isLocal ? "#ffd23c" : "#c850dc";
    ctx.fill();
  }
}

// ---- Boot ----

function boot(): void {
  setLoginBusy(true);
  setLoginStatus("Verbinde mit Server...", false);

  connection = connect(
    (conn) => {
      connection = conn;

      conn.db.player.onInsert((_ctx, row) => game?.players.set(row.playerId, toPlayerState(row)));
      conn.db.player.onUpdate((_ctx, _oldRow, row) => game?.players.set(row.playerId, toPlayerState(row)));
      conn.db.player.onDelete((_ctx, row) => game?.players.delete(row.playerId));

      conn
        .subscriptionBuilder()
        .onApplied(() => {
          setLoginBusy(false);
          setLoginStatus("", false);
        })
        .onError((ctx) => {
          setLoginStatus(
            `Konnte nicht mit dem Server synchronisieren: ${ctx.event?.message ?? "unbekannter Fehler"}`,
            true
          );
        })
        .subscribe([tables.player, tables.loginAttempt]);
    },
    (error) => {
      let message = `Verbindung zum Server fehlgeschlagen: ${error.message || error}`;
      if (location.protocol === "https:" && CONFIG.SERVER_URI.startsWith("ws:")) {
        message +=
          " - diese Seite läuft über HTTPS, der Server-URL ist aber ws:// " +
          `(${CONFIG.SERVER_URI}). Browser blockieren das als Mixed Content. ` +
          "Entweder einen wss://-Endpunkt per ?server=... angeben, oder die Seite " +
          "über http:// (localhost/LAN-IP) statt https:// öffnen.";
      }
      setLoginStatus(message, true);
      setLoginBusy(true);
    }
  );

  document.getElementById("register-button")!.addEventListener("click", () => handleAuth(doRegister));
  document.getElementById("login-button")!.addEventListener("click", () => handleAuth(doLogin));
  document.getElementById("logout-button-login")!.addEventListener("click", logout);
}

function logout(): void {
  clearCachedIdentity();
  location.reload();
}

// Guarded so importing this module for its pure exports (clamp, toPlayerState) under
// vitest doesn't also try to open a real connection / bind index.html's DOM elements -
// Vitest sets import.meta.env.MODE to "test" by default, never true outside a test run.
if (import.meta.env.MODE !== "test") {
  boot();
}
