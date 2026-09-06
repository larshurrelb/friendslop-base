import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: { include: ["libopus-wasm"] },
  build: { target: "es2022", outDir: "dist/client" },
  worker: { format: "es" },
});
