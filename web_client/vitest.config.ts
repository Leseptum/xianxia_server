import { defineConfig } from "vitest/config";

// jsdom: WorldGrid's constructor calls document.createElement("canvas") for its
// minimap (see src/world.ts) - the tests don't need real canvas *drawing*, just
// something that lets that call succeed so the grid's data logic is reachable.
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
