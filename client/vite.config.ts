import { defineConfig } from "vite";

// host: true binds the dev server to all interfaces (not just localhost) so the
// client is still reachable via a LAN IP during dev - src/config.ts derives the
// SpacetimeDB WebSocket URI from whatever hostname the page was loaded through
// (same convention as web_client/vite.config.ts).
export default defineConfig({
  server: { host: true, allowedHosts: ["antalia.leseptum.de"] },
  build: {
    // Phaser allein ist ~1.2 MB minifiziert - eigener Chunk, damit App-Code-Änderungen
    // den (selten wechselnden) Phaser-Chunk nicht aus dem Browser-Cache werfen.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ["phaser"] },
      },
    },
  },
});
