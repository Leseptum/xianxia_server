const SCALE = 4; // pixels per tile on the editor canvas

const BIOM_NAMES = {
  [BIOM.WASSER]: "Wasser",
  [BIOM.STRAND]: "Strand",
  [BIOM.EBENE]: "Ebene",
  [BIOM.WALD]: "Wald",
  [BIOM.BERG]: "Berg",
  [BIOM.SCHNEE]: "Schnee",
};

const client = new StdbClient(CONFIG.SERVER_URL, CONFIG.DATABASE_NAME);

const brush = { biom: BIOM.EBENE, kraeuter: 0, spiritStones: 0, holz: 0, erz: 0 };

let worldGrid = null;
let canvas = null;
let ctx = null;
let painting = false;
let lastPaintedTile = null;

function setStatus(message) {
  document.getElementById("editor-status").textContent = message;
}

function showError(message) {
  const banner = document.getElementById("error-banner");
  banner.textContent = message;
  banner.classList.remove("hidden");
}

function clearError() {
  document.getElementById("error-banner").classList.add("hidden");
}

function buildPalette() {
  const palette = document.getElementById("biom-palette");
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
      for (const el of palette.children) el.classList.remove("selected");
      button.classList.add("selected");
    });
    palette.appendChild(button);
  }
}

function bindResourceInputs() {
  const bindings = [
    ["brush-kraeuter", "kraeuter"],
    ["brush-spirit-stones", "spiritStones"],
    ["brush-holz", "holz"],
    ["brush-erz", "erz"],
  ];
  for (const [id, key] of bindings) {
    document.getElementById(id).addEventListener("input", (e) => {
      brush[key] = clamp255(Number(e.target.value) || 0);
    });
  }
}

function clamp255(v) {
  return Math.min(Math.max(Math.round(v), 0), 255);
}

function render() {
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
}

function tileFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / SCALE);
  const y = Math.floor((e.clientY - rect.top) / SCALE);
  if (x < 0 || y < 0 || x >= worldGrid.breite || y >= worldGrid.hoehe) return null;
  return { x, y };
}

async function paintAt(e) {
  const tile = tileFromEvent(e);
  if (!tile) return;

  document.getElementById("editor-hover").textContent = `Kachel: (${tile.x}, ${tile.y})`;

  if (lastPaintedTile && lastPaintedTile.x === tile.x && lastPaintedTile.y === tile.y) return;
  lastPaintedTile = tile;

  try {
    await client.callReducer("edit_tile", [
      tile.x,
      tile.y,
      brush.biom,
      brush.kraeuter,
      brush.spiritStones,
      brush.holz,
      brush.erz,
    ]);
    worldGrid.setTile(tile.x, tile.y, { ...brush });
    render();
    clearError();
  } catch (exc) {
    showError(exc.message || String(exc));
  }
}

function bindCanvasEvents() {
  canvas.addEventListener("mousedown", (e) => {
    painting = true;
    lastPaintedTile = null;
    paintAt(e);
  });
  window.addEventListener("mouseup", () => {
    painting = false;
    lastPaintedTile = null;
  });
  canvas.addEventListener("mousemove", (e) => {
    const tile = tileFromEvent(e);
    if (tile) document.getElementById("editor-hover").textContent = `Kachel: (${tile.x}, ${tile.y})`;
    if (painting) paintAt(e);
  });
}

async function boot() {
  try {
    await client.getOrCreateIdentity();
    setStatus("Lade Welt...");
    worldGrid = await loadWorld(client);
  } catch (exc) {
    setStatus(`Fehler: ${exc.message || exc}`);
    return;
  }

  canvas = document.getElementById("editor-canvas");
  canvas.width = worldGrid.breite * SCALE;
  canvas.height = worldGrid.hoehe * SCALE;
  ctx = canvas.getContext("2d");

  setStatus(`Welt geladen (${worldGrid.breite}x${worldGrid.hoehe}).`);
  buildPalette();
  bindResourceInputs();
  bindCanvasEvents();
  render();
}

boot();
