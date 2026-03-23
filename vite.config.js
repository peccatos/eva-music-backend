import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "frontend"),
  publicDir: resolve(__dirname, "music"),
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true,
      interval: 150,
    },
    hmr: {
      host: "127.0.0.1",
      port: 5173,
      protocol: "ws",
    },
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "frontend/index.html"),
        widget: resolve(__dirname, "frontend/widget.html"),
      },
    },
  },
});
