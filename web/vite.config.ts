import path from "node:path";

import { loadEnv } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname, ".."), "");
  const apiHost = env.HOST || "127.0.0.1";
  const apiPort = env.PORT || "3003";

  return {
    root: path.resolve(import.meta.dirname),
    plugins: [react()],
    server: {
      port: 5175,
      proxy: {
        "/api": `http://${apiHost}:${apiPort}`
      }
    },
    build: {
      outDir: path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true
    }
  };
});
