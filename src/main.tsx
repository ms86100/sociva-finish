// @ts-nocheck
import "./index.css";
import { initializeCapacitorPlugins } from "./lib/capacitor";

const BUILD_CACHE_VERSION = "2026-04-18-notification-queue-schema-fix-v4";

async function clearAppCaches() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch (e) {
    console.warn("[Bootstrap] Failed to clear caches:", e);
  }
}

async function ensureFreshBuild() {
  const appliedVersion = localStorage.getItem("app-build-cache-version");
  if (appliedVersion === BUILD_CACHE_VERSION) return;

  await clearAppCaches();
  localStorage.setItem("app-build-cache-version", BUILD_CACHE_VERSION);

  const reloadFlag = sessionStorage.getItem("build-cache-version-reloaded");
  if (!reloadFlag) {
    sessionStorage.setItem("build-cache-version-reloaded", "true");
    window.location.reload();
    throw new Error("[Bootstrap] Reloading after cache reset");
  }
}

function showFatalFallback() {
  const fails = Number(sessionStorage.getItem('boot-fails') || '0') + 1;
  sessionStorage.setItem('boot-fails', String(fails));

  const root = document.getElementById("root");
  if (!root) return;

  const showClear = fails >= 2;
  root.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100dvh;font-family:system-ui;padding:2rem;text-align:center"><div><h2>Something went wrong</h2><p style="color:#666;margin-top:8px">The app may still be using an old cached version. Please refresh.</p><button id="retry-boot-btn" style="margin-top:16px;padding:10px 14px;border-radius:10px;border:1px solid #ddd;background:white;cursor:pointer">Reload App</button>${showClear ? '<button id="clear-btn" style="margin-top:8px;padding:10px 14px;border-radius:10px;border:1px solid #e55;background:#fee;color:#c00;cursor:pointer;display:block;width:100%">Clear Cache &amp; Retry</button>' : ''}</div></div>`;

  document.getElementById("retry-boot-btn")?.addEventListener("click", () => {
    try { localStorage.removeItem('sb-kkzkuyhgdvyecmxtmkpy-auth-token'); } catch {}
    root.innerHTML = "";
    window.location.reload();
  });

  if (showClear) {
    document.getElementById("clear-btn")?.addEventListener("click", async () => {
      sessionStorage.clear();
      localStorage.clear();
      await clearAppCaches();
      window.location.reload();
    });
  }
}

function appDidNotMount() {
  const root = document.getElementById("root");
  return !!root && !root.hasAttribute("data-app-mounted");
}

function isChunkError(error: unknown): boolean {
  const msg = String(error);
  return msg.includes('Failed to fetch dynamically imported module') ||
         msg.includes('Loading chunk') ||
         msg.includes('Loading CSS chunk');
}

function handleChunkError(): boolean {
  const lastReload = Number(sessionStorage.getItem('chunk-reload-ts') || '0');
  const now = Date.now();
  if (now - lastReload > 10_000) {
    sessionStorage.setItem('chunk-reload-ts', String(now));
    window.location.reload();
    return true;
  }
  return false;
}

window.addEventListener("error", (event) => {
  if (isChunkError(event.error || event.message)) {
    if (handleChunkError()) return;
  }
  console.error("[Bootstrap] Unhandled error:", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  if (isChunkError(event.reason)) {
    if (handleChunkError()) return;
  }
  console.error("[Bootstrap] Unhandled rejection:", event.reason);
});

async function bootstrap() {
  await ensureFreshBuild();

  try {
    await initializeCapacitorPlugins();
  } catch (e) {
    console.error('[Bootstrap] Capacitor init failed, continuing without native plugins:', e);
  }

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("[Bootstrap] Missing root element");
  }

  const [{ createRoot }, { default: App }] = await Promise.all([
    import("react-dom/client"),
    import("./App.tsx"),
  ]);

  createRoot(rootElement).render(<App />);
  rootElement.setAttribute('data-app-mounted', 'true');
  sessionStorage.removeItem('boot-fails');

  window.setTimeout(() => {
    if (appDidNotMount()) {
      console.error("[Bootstrap] App did not mount within 10 seconds");
      showFatalFallback();
    }
  }, 10000);
}

bootstrap().catch((e) => {
  if (String(e).includes("Reloading after cache reset")) return;
  console.error('[Bootstrap] Fatal error:', e);
  showFatalFallback();
});
