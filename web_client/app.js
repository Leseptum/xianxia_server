const RETRY_ATTEMPTS = 10;
const RETRY_DELAY_MS = 150;

const client = new StdbClient(CONFIG.SERVER_URL, CONFIG.DATABASE_NAME);

const screens = {
  login: document.getElementById("login-screen"),
  loading: document.getElementById("loading-screen"),
  game: document.getElementById("game-screen"),
};

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle("hidden", key !== name);
  }
}

function setLoginStatus(message, isError) {
  const el = document.getElementById("login-status");
  el.textContent = message;
  el.style.color = isError ? "#e67878" : "#96e696";
}

function setLoginBusy(busy) {
  document.getElementById("register-button").disabled = busy;
  document.getElementById("login-button").disabled = busy;
  document.getElementById("name-input").disabled = busy;
  document.getElementById("password-input").disabled = busy;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForPlayerByName(name, extraWhere) {
  const where = extraWhere ? ` AND ${extraWhere}` : "";
  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    const rows = await client.sql(`SELECT * FROM player WHERE name = '${sqlEscape(name)}'${where}`);
    if (rows.length) return rows[0];
    await sleep(RETRY_DELAY_MS);
  }
  return null;
}

async function doRegister(name, password) {
  const hash = await sha256Hex(password);
  await client.callReducer("register", [name, hash]);
  const row = await pollForPlayerByName(name);
  if (!row) {
    throw new Error(
      "Registrierung hat kein Spielerobjekt erzeugt. Diese Tab-Identity ist vermutlich schon " +
        "mit einem anderen Namen registriert (der Server erlaubt nur einen Spieler pro " +
        "Identity) - unten 'Logout' klicken und erneut versuchen, oder einen neuen Tab öffnen."
    );
  }
  return row;
}

async function doLogin(name, password) {
  const hash = await sha256Hex(password);
  await client.callReducer("login", [name, hash]);
  const row = await pollForPlayerByName(name, `password_hash = '${sqlEscape(hash)}'`);
  if (!row) throw new Error("Login fehlgeschlagen: Name/Passwort falsch oder Spieler existiert nicht.");
  return row;
}

async function handleAuth(action) {
  const name = document.getElementById("name-input").value.trim();
  const password = document.getElementById("password-input").value;
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
    setLoginStatus(exc.message || String(exc), true);
  } finally {
    setLoginBusy(false);
  }
}

async function startGame(playerRow) {
  showScreen("loading");
  const loadingStatus = document.getElementById("loading-status");
  try {
    const worldGrid = await loadWorld(client);
    loadingStatus.textContent = "Fertig.";
    showScreen("game");
    initGame(playerRow, worldGrid);
  } catch (exc) {
    loadingStatus.textContent = `Fehler: ${exc.message || exc}`;
  }
}

// ---- Game state ----

let game = null;

function initGame(localPlayerRow, worldGrid) {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");

  game = {
    canvas,
    ctx,
    worldGrid,
    localPlayerId: Number(localPlayerRow.player_id),
    players: new Map(), // player_id -> row, refreshed by polling
    posX: Math.floor(Number(localPlayerRow.pos_x)),
    posY: Math.floor(Number(localPlayerRow.pos_y)),
    keys: new Set(),
    viewMode: "follow",
    lastStepAt: 0,
    lastFrameAt: performance.now(),
    errorMessage: null,
  };

  window.addEventListener("keydown", (e) => {
    game.keys.add(e.key.toLowerCase());
    if (e.key.toLowerCase() === "m") {
      game.viewMode = game.viewMode === "follow" ? "map" : "follow";
    }
  });
  window.addEventListener("keyup", (e) => game.keys.delete(e.key.toLowerCase()));

  document.getElementById("collect-button").addEventListener("click", () => {
    callReducerAndRefresh("qi_sammeln", [game.localPlayerId, 10]);
  });
  document.getElementById("breakthrough-button").addEventListener("click", () => {
    callReducerAndRefresh("durchbruch", [game.localPlayerId]);
  });
  document.getElementById("logout-button-game").addEventListener("click", logout);

  pollPlayers();
  setInterval(pollPlayers, CONFIG.POLL_INTERVAL_MS);
  requestAnimationFrame(frame);
}

async function callReducerAndRefresh(reducer, args) {
  try {
    await client.callReducer(reducer, args);
    await pollPlayers();
  } catch (exc) {
    showError(exc.message || String(exc));
  }
}

async function pollPlayers() {
  try {
    const rows = await client.sql("SELECT * FROM player");
    const players = new Map();
    for (const row of rows) {
      players.set(Number(row.player_id), {
        playerId: Number(row.player_id),
        name: row.name,
        qi: Number(row.qi),
        qiMaximum: Number(row.qi_maximum),
        stufe: Number(row.stufe),
        posX: Number(row.pos_x),
        posY: Number(row.pos_y),
      });
    }
    game.players = players;
    clearError();
  } catch (exc) {
    showError(exc.message || String(exc));
  }
}

function showError(message) {
  game.errorMessage = message;
  const banner = document.getElementById("error-banner");
  banner.textContent = message;
  banner.classList.remove("hidden");
}

function clearError() {
  game.errorMessage = null;
  document.getElementById("error-banner").classList.add("hidden");
}

function frame(now) {
  const dt = Math.min((now - game.lastFrameAt) / 1000, 0.1);
  game.lastFrameAt = now;

  update(dt, now);
  render();

  requestAnimationFrame(frame);
}

function update(dt, now) {
  // Grid movement: one tile per step, 4 directions only (no diagonals - an
  // else-if chain so only one axis is ever chosen), throttled to
  // STEP_INTERVAL_MS while a key is held.
  if (now - game.lastStepAt >= CONFIG.STEP_INTERVAL_MS) {
    let dx = 0;
    let dy = 0;
    if (game.keys.has("a") || game.keys.has("arrowleft")) dx = -1;
    else if (game.keys.has("d") || game.keys.has("arrowright")) dx = 1;
    else if (game.keys.has("w") || game.keys.has("arrowup")) dy = -1;
    else if (game.keys.has("s") || game.keys.has("arrowdown")) dy = 1;

    if (dx !== 0 || dy !== 0) {
      const nextX = clamp(game.posX + dx, 0, game.worldGrid.breite - 1);
      const nextY = clamp(game.posY + dy, 0, game.worldGrid.hoehe - 1);
      if (isWalkable(nextX, nextY)) {
        game.posX = nextX;
        game.posY = nextY;
        game.lastStepAt = now;
        client
          .callReducer("update_position", [game.localPlayerId, game.posX, game.posY])
          .catch((exc) => showError(exc.message || String(exc)));
      }
    }
  }

  updateHud();
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function isWalkable(x, y) {
  const biom = game.worldGrid.getBiom(Math.floor(x), Math.floor(y));
  return biom !== null && biom !== BIOM.WASSER && biom !== BIOM.BERG;
}

function updateHud() {
  const local = game.players.get(game.localPlayerId);
  const breakthroughButton = document.getElementById("breakthrough-button");
  if (!local) {
    document.getElementById("hud-name").textContent = "Warte auf Server-Daten...";
    document.getElementById("qi-text").textContent = "";
    document.getElementById("qi-bar-fill").style.width = "0%";
    breakthroughButton.disabled = true;
    return;
  }
  document.getElementById("hud-name").textContent = `${local.name} - Stufe ${local.stufe}`;
  document.getElementById("qi-text").textContent = `Qi: ${local.qi} / ${local.qiMaximum}`;
  const ratio = local.qiMaximum === 0 ? 0 : Math.min(local.qi / local.qiMaximum, 1);
  document.getElementById("qi-bar-fill").style.width = `${ratio * 100}%`;
  breakthroughButton.disabled = local.qi < local.qiMaximum;
}

function cameraOrigin() {
  const canvas = game.canvas;
  const visibleCols = canvas.width / CONFIG.TILE_SIZE + 2;
  const visibleRows = (canvas.height - CONFIG.HUD_HEIGHT) / CONFIG.TILE_SIZE + 2;
  return {
    camX: game.posX - visibleCols / 2,
    camY: game.posY - visibleRows / 2,
    cols: visibleCols,
    rows: visibleRows,
  };
}

function render() {
  const { ctx, canvas } = game;
  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (game.viewMode === "map") {
    drawFullMap();
  } else {
    drawWorld();
    drawPlayers();
  }
}

function drawWorld() {
  const { ctx, worldGrid } = game;
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

function drawPlayers() {
  const { ctx } = game;
  const { camX, camY } = cameraOrigin();

  for (const [playerId, player] of game.players) {
    const isLocal = playerId === game.localPlayerId;
    const worldX = isLocal ? game.posX : player.posX;
    const worldY = isLocal ? game.posY : player.posY;

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
  const canvas = game.canvas;
  const worldGrid = game.worldGrid;
  const margin = CONFIG.MAP_MARGIN;
  const areaW = canvas.width - 2 * margin;
  const areaH = canvas.height - CONFIG.HUD_HEIGHT - 2 * margin;
  const scale = Math.min(areaW / worldGrid.breite, areaH / worldGrid.hoehe);
  const drawW = worldGrid.breite * scale;
  const drawH = worldGrid.hoehe * scale;
  const originX = margin + (areaW - drawW) / 2;
  const originY = margin + (areaH - drawH) / 2;
  return { scale, drawW, drawH, originX, originY };
}

function drawFullMap() {
  const { ctx, worldGrid } = game;
  const { scale, drawW, drawH, originX, originY } = mapLayout();

  ctx.drawImage(worldGrid.minimapCanvas, originX, originY, drawW, drawH);
  ctx.strokeStyle = "#50505a";
  ctx.strokeRect(originX, originY, drawW, drawH);

  for (const [playerId, player] of game.players) {
    const isLocal = playerId === game.localPlayerId;
    const worldX = isLocal ? game.posX : player.posX;
    const worldY = isLocal ? game.posY : player.posY;
    const px = originX + worldX * scale;
    const py = originY + worldY * scale;

    ctx.beginPath();
    ctx.arc(px, py, isLocal ? 4 : 3, 0, 2 * Math.PI);
    ctx.fillStyle = isLocal ? "#ffd23c" : "#c850dc";
    ctx.fill();
  }
}

// ---- Boot ----

async function boot() {
  try {
    await client.getOrCreateIdentity();
  } catch (exc) {
    let message = `Verbindung zum Server fehlgeschlagen: ${exc.message || exc}`;
    if (location.protocol === "https:" && CONFIG.SERVER_URL.startsWith("http:")) {
      message +=
        " - diese Seite läuft über HTTPS, der Server-URL ist aber http:// " +
        `(${CONFIG.SERVER_URL}). Browser blockieren das als Mixed Content. ` +
        "Entweder einen https://-Endpunkt per ?server=... angeben, oder die Seite " +
        "über http:// (localhost/LAN-IP) statt https:// öffnen.";
    }
    setLoginStatus(message, true);
    setLoginBusy(true);
    return;
  }
  document.getElementById("register-button").addEventListener("click", () => handleAuth(doRegister));
  document.getElementById("login-button").addEventListener("click", () => handleAuth(doLogin));
  document.getElementById("logout-button-login").addEventListener("click", logout);
}

function logout() {
  sessionStorage.removeItem(IDENTITY_STORAGE_KEY);
  location.reload();
}

boot();
