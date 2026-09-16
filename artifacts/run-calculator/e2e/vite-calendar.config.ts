import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT ?? 4177);

export default defineConfig({
  root,
  cacheDir: path.resolve(root, "node_modules/.vite-calendar-e2e"),
  plugins: [react(), tailwindcss({ optimize: false })],
  optimizeDeps: {
    entries: ["e2e/calendar-fixture.html"],
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port,
    strictPort: true,
    host: "127.0.0.1",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
});