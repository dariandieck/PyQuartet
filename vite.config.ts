import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs so the build works under https://<user>.github.io/PyQuartet/ without hardcoding the repo name.
  base: "./",
  build: {
    rollupOptions: {
      // Two pages: the game and the card gallery.
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        cards: resolve(import.meta.dirname, "cards.html"),
      },
    },
  },
});
