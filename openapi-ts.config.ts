import { defineConfig } from "@hey-api/openapi-ts";

// Types only. `src/lib/api.ts` keeps the transport: the bearer token comes from
// the Tauri handshake at runtime, and the SSE frames are parsed by hand.
export default defineConfig({
  input: "openapi.json",
  output: {
    path: "src/lib/generated",
    clean: true,
    postProcess: ["prettier"],
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      enums: false,
    },
  ],
});
