import * as Phaser from "phaser";
import { BIOM, biomColorCss } from "../world";

// Programmatisch erzeugte Platzhalter-Grafiken - keine Asset-Dateien. Werden einmal in der
// BootScene angelegt und über die Keys unten von allen Szenen benutzt.

export const TEXTURES = {
  biomeTiles: "biome-tiles",
  player: "player",
  creature: "creature",
  ring: "ring",
} as const;

export const BIOM_COUNT = 6; // Biom-Enum in Lib.cs: Wasser..Schnee = 0..5

// 1 px Rand + 2 px Abstand zwischen den Tiles im Tileset, damit lineares Texture-Filtering bei
// gebrochenem Zoom keine Farbe des Nachbar-Tiles in den Rand blutet.
export const TILESET_MARGIN = 1;
export const TILESET_SPACING = 2;

/** Biom-Byte -> Tile-Index im Tileset (1:1). Unbekannte Werte -> leeres Tile. */
export function tileIndexForBiom(biom: number | null): number {
  return biom !== null && biom >= 0 && biom < BIOM_COUNT ? biom : -1;
}

/** Ursprung (Fußpunkt) der Figuren-Texturen, relativ - damit die Füße auf der Kachelmitte stehen. */
export const FEET_ORIGIN = {
  [TEXTURES.player]: { x: 0.5, y: 41 / 46 },
  [TEXTURES.creature]: { x: 0.5, y: 26 / 30 },
} as const;

export function createPlaceholderTextures(scene: Phaser.Scene, tileWidth: number, tileHeight: number): void {
  createBiomeTileset(scene, tileWidth, tileHeight);
  createPlayerTexture(scene);
  createCreatureTexture(scene);
  createRingTexture(scene);
}

/**
 * Ein Tile pro Biom als volles Rechteck. Die Grundfarbe wird um 1 px in Rand/Abstand des
 * Tilesets hinein "extrudiert" - so blutet bei gebrochenem Zoom (lineares Filtering) keine
 * fremde Farbe in die Tile-Kante, und es entstehen keine Haarlinien-Lücken zwischen Tiles.
 */
function createBiomeTileset(scene: Phaser.Scene, w: number, h: number): void {
  const width = TILESET_MARGIN * 2 + BIOM_COUNT * w + (BIOM_COUNT - 1) * TILESET_SPACING;
  const height = TILESET_MARGIN * 2 + h;
  const tex = scene.textures.createCanvas(TEXTURES.biomeTiles, width, height);
  if (!tex) throw new Error("Konnte Biom-Tileset-Textur nicht anlegen.");
  const ctx = tex.getContext();

  for (let biom = 0; biom < BIOM_COUNT; biom++) {
    const ox = TILESET_MARGIN + biom * (w + TILESET_SPACING);
    const oy = TILESET_MARGIN;

    ctx.fillStyle = biomColorCss(biom);
    ctx.fillRect(ox - 1, oy - 1, w + 2, h + 2);

    drawBiomeDetail(ctx, biom, ox, oy, w, h);

    // Dezente Kante unten/rechts -> das Gitter bleibt lesbar, die untere Kante betont die
    // Schrägansicht leicht.
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(ox, oy + h - 2, w, 2);
    ctx.fillStyle = "rgba(0,0,0,0.07)";
    ctx.fillRect(ox + w - 1, oy, 1, h - 2);
  }
  tex.refresh();
}

/** Ein paar deterministische Sprenkel pro Biom, damit die Flächen nicht völlig flach wirken. */
function drawBiomeDetail(
  ctx: CanvasRenderingContext2D,
  biom: number,
  ox: number,
  oy: number,
  w: number,
  h: number
): void {
  let seed = 1 + biom * 7919;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const speckle = (count: number, color: string, sw: number, sh: number) => {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const px = (rnd() * 2 - 1) * 0.8;
      const py = (rnd() * 2 - 1) * 0.75;
      ctx.fillRect(Math.round(ox + w / 2 + (px * w) / 2 - sw / 2), Math.round(oy + h / 2 + (py * h) / 2 - sh / 2), sw, sh);
    }
  };

  switch (biom) {
    case BIOM.WASSER:
      speckle(5, "rgba(255,255,255,0.28)", 6, 1); // Wellen
      break;
    case BIOM.STRAND:
      speckle(10, "rgba(150,120,60,0.35)", 1, 1);
      break;
    case BIOM.EBENE:
      speckle(9, "rgba(60,120,40,0.45)", 2, 1); // Grasbüschel
      break;
    case BIOM.WALD:
      speckle(5, "rgba(15,60,25,0.6)", 5, 3); // Baumkronen
      break;
    case BIOM.BERG:
      speckle(6, "rgba(70,70,75,0.6)", 4, 2);
      speckle(4, "rgba(205,205,210,0.5)", 3, 1);
      break;
    case BIOM.SCHNEE:
      speckle(7, "rgba(170,180,205,0.5)", 2, 1);
      break;
  }
}

// Figuren sind weiß gezeichnet und werden per setTint eingefärbt (Spieler/NPC-Kategorie);
// Schatten und Kontur sind schwarz und bleiben unter dem Tint schwarz.

function createPlayerTexture(scene: Phaser.Scene): void {
  const tex = scene.textures.createCanvas(TEXTURES.player, 28, 46);
  if (!tex) throw new Error("Konnte Spieler-Textur nicht anlegen.");
  const ctx = tex.getContext();

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(14, 41, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); // Robe
  ctx.moveTo(14, 15);
  ctx.lineTo(23, 39);
  ctx.quadraticCurveTo(14, 44, 5, 39);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath(); // Kopf
  ctx.arc(14, 10, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  tex.refresh();
}

function createCreatureTexture(scene: Phaser.Scene): void {
  const tex = scene.textures.createCanvas(TEXTURES.creature, 32, 30);
  if (!tex) throw new Error("Konnte NPC-Textur nicht anlegen.");
  const ctx = tex.getContext();

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(16, 26, 11, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(16, 17, 12, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#1a1a1a";
  for (const ex of [12, 20]) {
    ctx.beginPath();
    ctx.arc(ex, 15, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  tex.refresh();
}

/** Markierungsring unter dem eigenen Spieler (flache Ellipse, passend zur Schrägansicht). */
function createRingTexture(scene: Phaser.Scene): void {
  const tex = scene.textures.createCanvas(TEXTURES.ring, 44, 22);
  if (!tex) throw new Error("Konnte Ring-Textur nicht anlegen.");
  const ctx = tex.getContext();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(22, 11, 19, 9, 0, 0, Math.PI * 2);
  ctx.stroke();
  tex.refresh();
}
