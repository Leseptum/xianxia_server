import { tables, type DbConnection } from "./module_bindings";
import { connect } from "./connection";
import { sha256Hex } from "./sha256";
import { loadWorld, biomColorCss, BIOM, type WorldGrid, type Tile } from "./world";

const SCALE = 4; // pixels per tile on the editor canvas

const BIOM_NAMES: Record<number, string> = {
  [BIOM.WASSER]: "Wasser",
  [BIOM.STRAND]: "Strand",
  [BIOM.EBENE]: "Ebene",
  [BIOM.WALD]: "Wald",
  [BIOM.BERG]: "Berg",
  [BIOM.SCHNEE]: "Schnee",
};

let connection: DbConnection | null = null;

const brush: Tile = { biom: BIOM.EBENE, kraeuter: 0, spiritStones: 0, holz: 0, erz: 0 };

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

function render(): void {
  ctx!.imageSmoothingEnabled = false;
  ctx!.drawImage(
    worldGrid!.minimapCanvas,
    0,
    0,
    worldGrid!.breite,
    worldGrid!.hoehe,
    0,
    0,
    canvas!.width,
    canvas!.height
  );
}

function tileFromEvent(e: MouseEvent): { x: number; y: number } | null {
  const rect = canvas!.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / SCALE);
  const y = Math.floor((e.clientY - rect.top) / SCALE);
  if (x < 0 || y < 0 || x >= worldGrid!.breite || y >= worldGrid!.hoehe) return null;
  return { x, y };
}

async function paintAt(e: MouseEvent): Promise<void> {
  const tile = tileFromEvent(e);
  if (!tile) return;

  document.getElementById("editor-hover")!.textContent = `Kachel: (${tile.x}, ${tile.y})`;

  if (lastPaintedTile && lastPaintedTile.x === tile.x && lastPaintedTile.y === tile.y) return;
  lastPaintedTile = tile;

  try {
    await connection!.reducers.editTile({
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

function bindCanvasEvents(): void {
  canvas!.addEventListener("mousedown", (e) => {
    painting = true;
    lastPaintedTile = null;
    paintAt(e);
  });
  window.addEventListener("mouseup", () => {
    painting = false;
    lastPaintedTile = null;
  });
  canvas!.addEventListener("mousemove", (e) => {
    const tile = tileFromEvent(e);
    if (tile) document.getElementById("editor-hover")!.textContent = `Kachel: (${tile.x}, ${tile.y})`;
    if (painting) paintAt(e);
  });
}

async function startEditor(): Promise<void> {
  document.getElementById("login-screen")!.classList.add("hidden");
  document.getElementById("editor-screen")!.classList.remove("hidden");

  try {
    setStatus("Lade Welt...");
    worldGrid = await loadWorld(connection!);
  } catch (exc) {
    setStatus(`Fehler: ${exc instanceof Error ? exc.message : String(exc)}`);
    return;
  }

  canvas = document.getElementById("editor-canvas") as HTMLCanvasElement;
  canvas.width = worldGrid.breite * SCALE;
  canvas.height = worldGrid.hoehe * SCALE;
  ctx = canvas.getContext("2d")!;

  setStatus(`Welt geladen (${worldGrid.breite}x${worldGrid.hoehe}).`);
  buildPalette();
  bindResourceInputs();
  bindCanvasEvents();
  render();
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
