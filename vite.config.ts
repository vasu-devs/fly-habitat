import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: "public",
  assetsInclude: ["**/*.wgsl"],
  build: {
    outDir: "dist",
    target: "esnext",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "app.html"),
        play: resolve(__dirname, "play.html"),
        bench: resolve(__dirname, "bench.html"),
        lab: resolve(__dirname, "lab.html"),
        world: resolve(__dirname, "world.html"),
        research: resolve(__dirname, "research.html"),
      },
    },
  },
  server: { port: 4173, strictPort: true, host: "127.0.0.1" },
});
