import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

export default defineConfig({
  plugins: [fresh()],
  // The `postgres` driver is a server-only dependency; keep it out of the
  // client bundle and Vite's dep pre-bundling so SSR uses the real module.
  ssr: {
    external: ["postgres"],
  },
  optimizeDeps: {
    exclude: ["postgres", "$db"],
  },
});
