import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(path.dirname(new URL(import.meta.url).pathname), "./ui"),
    },
  },

  build: {
    // The only browser this ever runs in is the WKWebView on the macOS version
    // tauri.conf.json already requires. Vite's default target downlevels for
    // browsers that cannot reach this app, which costs bundle size and parse
    // time at every launch to support nothing.
    target: "safari17",
    rollupOptions: {
      output: {
        // React and the Base UI primitives change only when dependencies are
        // upgraded, while app code changes constantly. Splitting them apart
        // keeps the large, stable half in its own file instead of rewriting a
        // half-megabyte chunk on every build.
        manualChunks: {
          vendor: ["react", "react-dom", "@base-ui/react", "@tanstack/react-virtual"],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `tauri-src`
      ignored: ["**/tauri-src/**"],
    },
  },
}));
