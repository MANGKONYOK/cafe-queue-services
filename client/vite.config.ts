/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Same origin in production (Express serves dist/); Vite proxies /api in development.
  server: { proxy: { "/api": "http://localhost:3000" } },
  test: {
    environment: "jsdom",
    setupFiles: ["src/__tests__/setup.ts"],
  },
});
