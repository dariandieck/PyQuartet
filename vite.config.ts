import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs so the build works under https://<user>.github.io/PyQuartet/ without hardcoding the repo name.
  base: "./",
});
