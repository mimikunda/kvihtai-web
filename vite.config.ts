import { defineConfig } from "vite";

// In development the app talks to a kvihtai-core running on this machine, or
// on the Pi: KVIHTAI_CORE=http://192.168.1.174:8080 npm run dev
const core = process.env.KVIHTAI_CORE ?? "http://localhost:8080";

export default defineConfig({
  server: {
    host: true,
    proxy: {
      "/api": core,
      "/ws": { target: core.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    target: "es2020",
    assetsInlineLimit: 0,
  },
});
