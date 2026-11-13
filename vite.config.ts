import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

/**
 * Dev-only bridge to the Go sidecar handshake. `bun run backend:dev` writes
 * ~/.triage/dev-handshake.json; the webview reads it over the dev origin so the
 * token never enters the bundle or `import.meta.env`.
 */
function triageDevHandshake(): Plugin {
  const path = join(homedir(), ".triage", "dev-handshake.json");

  return {
    name: "triage-dev-handshake",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/.triage-handshake", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        try {
          res.end(readFileSync(path, "utf8"));
        } catch {
          res.statusCode = 503;
          res.end(
            JSON.stringify({
              error: {
                code: "handshake_unavailable",
                message: "triage-server is not running (bun run backend:dev)",
              },
            }),
          );
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), triageDevHandshake()],

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
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
