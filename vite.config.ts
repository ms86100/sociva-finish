import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import ViteTsconfigPaths from "vite-tsconfig-paths";

// Drop Workbox for native shell builds. Use `npm run build:native` (mode=capacitor)
// or CAPACITOR_ENV=production — matches Codemagic android-release.
const isNativeProdBuild =
  process.env.CAPACITOR_ENV === "production" || process.env.CAPACITOR_BUILD === "1";

/** Keep website APK downloads out of Capacitor bundles (self-nesting blows past GitHub's 100MB limit). */
function omitApkFromNativeDist(enabled: boolean): Plugin {
  return {
    name: "omit-apk-from-native-dist",
    apply: "build",
    closeBundle() {
      if (!enabled) return;
      const apkPath = path.resolve(__dirname, "dist/downloads/sociva-android.apk");
      if (fs.existsSync(apkPath)) {
        fs.unlinkSync(apkPath);
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const skipPwa = isNativeProdBuild || mode === "capacitor";
  const isCapacitorBuild = mode === "capacitor" || isNativeProdBuild;

  return {
    server: {
      host: "::",
      port: 3000,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      omitApkFromNativeDist(isCapacitorBuild),
      ViteTsconfigPaths(),
      !skipPwa &&
        VitePWA({
          registerType: "autoUpdate",
          injectRegister: "auto",
          includeAssets: ["favicon.ico", "apple-touch-icon.png", "android-chrome-192x192.png"],
          manifest: false,
          workbox: {
            cleanupOutdatedCaches: true,
            clientsClaim: true,
            skipWaiting: true,
            navigateFallbackDenylist: [/^\/~oauth/, /^\/\.well-known\//],
            globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
            runtimeCaching: [
              // Never cache Auth/REST/RPC through Workbox — NetworkFirst + status 0
              // previously prolonged cold starts and could stick empty/error responses.
              {
                urlPattern: /^https:\/\/kkzkuyhgdvyecmxtmkpy\.supabase\.co\/.*/i,
                handler: "NetworkOnly",
              },
              {
                urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
                handler: "CacheFirst",
                options: {
                  cacheName: "image-cache",
                  expiration: {
                    maxEntries: 100,
                    maxAgeSeconds: 60 * 60 * 24 * 30,
                  },
                  cacheableResponse: {
                    statuses: [200],
                  },
                },
              },
            ],
          },
        }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      tsconfigPaths: true,
      dedupe: ["react", "react-dom", "react/jsx-runtime"],
    },
    build: {
      // Production optimizations
      minify: "terser",
      terserOptions: {
        compress: {
          // Keep console.error and console.warn in production for debugging
          pure_funcs: mode === "production" ? ["console.log", "console.debug", "console.info"] : [],
          drop_debugger: true,
        },
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            const p = id.replace(/\\/g, "/");
            // Keep the entire React family together. Splitting jsx-runtime into
            // another vendor chunk (e.g. motion) caused entry to side-effect
            // import a huge "charts" shared chunk before first paint.
            if (
              p.includes("/react-dom/") ||
              p.includes("/react-router") ||
              p.includes("/react/") ||
              p.includes("/scheduler/")
            ) {
              return "react";
            }
            if (p.includes("@radix-ui")) return "ui-radix";
            if (p.includes("@supabase")) return "supabase";
            if (p.includes("framer-motion")) return "motion";
            // Do NOT force a single lucide chunk — that pulled ~400KB onto the
            // critical path whenever any entry import touched lucide-react.
            // Per-route tree-shaking keeps Home icons small.
            if (p.includes("react-hook-form") || p.includes("@hookform") || p.includes("/zod/")) return "forms";
            if (p.includes("@vis.gl/react-google-maps") || p.includes("/google.maps")) return "maps";
            // Do NOT force a shared "charts" chunk — recharts must stay with
            // lazy product/analytics routes so Home cold start does not download it.
            if (p.includes("date-fns")) return "date";
            if (p.includes("@capacitor")) return "capacitor";
            if (p.includes("@tanstack/react-query")) return "query";
          },
        },
      },
    },
  };
});
