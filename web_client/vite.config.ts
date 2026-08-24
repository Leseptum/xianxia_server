import { defineConfig } from "vite";
import { resolve } from "node:path";

// host: true binds the dev server to all interfaces (not just localhost) so the
// client is still reachable via a LAN IP during dev - see src/config.ts, which
// derives the SpacetimeDB WebSocket URI from whatever hostname the page was
// loaded through, matching how python3 -m http.server was used before.
export default defineConfig({
  server: { host: true, allowedHosts: ["antalia.leseptum.de"] },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        editor: resolve(__dirname, "editor.html"),
      },
    },
  },
});
