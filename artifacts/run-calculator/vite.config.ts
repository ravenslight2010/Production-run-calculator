import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

const rawPort = process.env.PORT;

// PORT is only used for server.port / preview.port, which are both ignored
// during `vite build`.  Allow it to be absent (e.g. in the deployment build
// step) so the build doesn't fail on a variable that has no effect there.
const port = rawPort ? Number(rawPort) : 5173;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH affects the `base` option which IS relevant during builds.
// Default to "/" (the production root) when not explicitly provided.
const basePath = process.env.BASE_PATH ?? "/";
const webBuildId =
  process.env.VITE_APP_VERSION?.trim() ||
  process.env.REPLIT_DEPLOYMENT_ID?.trim() ||
  process.env.REPLIT_DEPLOYMENT?.trim() ||
  "local";

// Dev-only (Replit). The preview runs inside an HTTPS-proxied iframe where
// Vite's HMR websocket can't stay connected — it drops every so often, and
// Vite's injected `@vite/client` calls `location.reload()` on every reconnect,
// full-reloading the page and aborting whatever the user was doing (e.g. a
// spec/Excel import that takes longer than the drop interval). We can't keep the
// socket alive (that's the proxy's behavior) and `server.hmr: false` does NOT
// remove the client's reconnect-reload in Vite 7, so we patch the served client
// to turn its `location.reload()` calls into no-ops. HMR module updates still
// apply while the socket is up; only the disruptive full-page reloads are gone.
function suppressViteClientReload(): Plugin {
  return {
    name: "replit-suppress-vite-client-reload",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqPath = (req.url ?? "").split("?")[0];
        if (!reqPath.endsWith("/@vite/client")) return next();
        // Force a full 200 body (no conditional 304) so we can rewrite it.
        delete req.headers["if-none-match"];
        const chunks: Buffer[] = [];
        const origEnd = res.end.bind(res);
        res.write = ((chunk: unknown) => {
          if (chunk)
            chunks.push(
              Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string),
            );
          return true;
        }) as typeof res.write;
        res.end = ((chunk?: unknown) => {
          if (chunk)
            chunks.push(
              Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string),
            );
          const body = Buffer.concat(chunks)
            .toString("utf8")
            .split("location.reload()")
            .join('console.debug("[vite] full page reload suppressed (Replit preview)")');
          res.setHeader("Content-Length", Buffer.byteLength(body));
          res.setHeader("Cache-Control", "no-store");
          res.removeHeader("ETag");
          return origEnd(body);
        }) as typeof res.end;
        next();
      });
    },
  };
}

export default defineConfig({
  base: basePath,
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(webBuildId),
  },
  plugins: [
    ...(process.env.REPL_ID ? [suppressViteClientReload()] : []),
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    VitePWA({
      // New workers activate without claiming an existing page. That makes a
      // plain, user-chosen reload from an older error screen load the fixed
      // bundle, while `clientsClaim: false` ensures an active run is never
      // interrupted. AppUpdatePrompt still offers the explicit reload action.
      registerType: "prompt",
      base: basePath,
      includeAssets: [
        "favicon.svg",
        "favicon.ico",
        "apple-touch-icon-180x180.png",
        "pwa-64x64.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
        "maskable-icon-512x512.png",
      ],
      manifest: {
        name: "Production Run Calculator",
        short_name: "Run Calc",
        description: "Pizza production line planning and schedule estimation.",
        theme_color: "#FF9500",
        background_color: "#0f1117",
        display: "standalone",
        orientation: "portrait",
        scope: basePath,
        start_url: basePath,
        icons: [
          {
            src: "pwa-64x64.png",
            sizes: "64x64",
            type: "image/png",
          },
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: false,
        // The main bundle crossed workbox's default 2 MiB precache cap
        // (build hard-fails, not just a warning). Allow up to 4 MiB.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    // Playwright writes HTML reports, traces, screenshots, and other retained
    // failure artifacts under the calculator root. They are not app source and
    // must not trigger a Vite reload while browser checks are running.
    watch: {
      ignored: ["**/playwright-report/**", "**/test-results/**"],
    },
    // Keep local/CI browser journeys same-origin while the API runs separately.
    // Replit's production proxy provides this routing outside Vite.
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
