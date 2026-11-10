// @ts-nocheck
import "./index.css";
import { initializeCapacitorPlugins } from "./lib/capacitor";
import { captureException, initObservability } from "./lib/observability";
import {
  BUILD_CACHE_VERSION,
  BUILD_CACHE_RELOADED_KEY,
  BUILD_CACHE_VERSION_KEY,
  canAutoRecoverStaleDeploy,
  clearStaleDeployRecoveryMarks,
  isChunkLoadError,
  markStaleDeployRecoveryAttempt,
  staleDeployRecoveryCopy,
  withDeployRefreshParam,
} from "./lib/stale-deploy-recovery";

// Amplitude loads after first paint. captureException stays sync and queues
// anything that happens before Sentry arrives. The Sentry SDK itself is still
// a dynamic import inside initObservability.
function scheduleAnalyticsAndObservability() {
  const start = () => {
    initObservability();
    import("./lib/analytics")
      .then((mod) => mod.initAnalytics())
      .catch((err) => console.warn("[Bootstrap] Analytics init failed:", err));
  };
  const ric = window.requestIdleCallback;
  if (typeof ric === "function") {
    ric(start, { timeout: 2000 });
  } else {
    setTimeout(start, 1);
  }
}

// Performance markers for landing page load analysis
const perfMarks = {};
function mark(name) {
  perfMarks[name] = performance.now();
  console.debug(`[Perf] ${name}: ${perfMarks[name].toFixed(0)}ms`);
}
mark("start");

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

function paintRecoveryShell(copy: { title: string; body: string; primary: string; secondary?: string }, opts: {
  busy?: boolean;
  onPrimary?: () => void;
  onSecondary?: () => void;
}) {
  const root = document.getElementById("root");
  if (!root) return;

  const secondaryHtml = copy.secondary
    ? `<button id="recovery-secondary-btn" type="button" style="margin-top:10px;padding:12px 16px;border-radius:12px;border:1px solid #e5e5e5;background:#fff;color:#444;cursor:pointer;display:block;width:100%;font-size:14px">${copy.secondary}</button>`
    : "";

  root.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:100dvh;font-family:system-ui,-apple-system,sans-serif;padding:2rem;text-align:center;background:#fafafa;color:#111"><div style="max-width:22rem;width:100%"><div style="width:48px;height:48px;border-radius:14px;background:#111;margin:0 auto 18px;display:flex;align-items:center;justify-content:center"><span style="color:#fff;font-weight:700;font-size:18px;letter-spacing:-0.02em">S</span></div><h2 style="font-size:1.35rem;font-weight:700;margin:0;letter-spacing:-0.02em">${copy.title}</h2><p style="color:#666;margin:10px 0 0;line-height:1.45;font-size:0.95rem">${copy.body}</p><button id="recovery-primary-btn" type="button" ${opts.busy ? "disabled" : ""} style="margin-top:22px;padding:12px 16px;border-radius:12px;border:none;background:#111;color:#fff;cursor:${opts.busy ? "wait" : "pointer"};display:block;width:100%;font-size:14px;font-weight:600">${copy.primary}</button>${secondaryHtml}</div></div>`;

  if (opts.onPrimary && !opts.busy) {
    document.getElementById("recovery-primary-btn")?.addEventListener("click", opts.onPrimary);
  }
  if (opts.onSecondary && copy.secondary) {
    document.getElementById("recovery-secondary-btn")?.addEventListener("click", opts.onSecondary);
  }
}

function showUpdatingSplash() {
  paintRecoveryShell(staleDeployRecoveryCopy({ mode: "updating" }), { busy: true });
}

async function recoverFromStaleDeploy(reason: string): Promise<boolean> {
  if (!canAutoRecoverStaleDeploy()) return false;
  markStaleDeployRecoveryAttempt();
  console.warn("[Bootstrap] Recovering from stale deploy:", reason);
  showUpdatingSplash();
  await clearAppCaches();
  // Keep auth. Only drop service-worker / Cache Storage, then hard-navigate.
  window.location.replace(withDeployRefreshParam(window.location.href));
  return true;
}

async function ensureFreshBuild() {
  const appliedVersion = localStorage.getItem(BUILD_CACHE_VERSION_KEY);
  if (appliedVersion === BUILD_CACHE_VERSION) return;

  // Mark version first so a failed clear cannot loop forever on every boot.
  localStorage.setItem(BUILD_CACHE_VERSION_KEY, BUILD_CACHE_VERSION);
  showUpdatingSplash();
  await clearAppCaches();

  const reloadFlag = sessionStorage.getItem(BUILD_CACHE_RELOADED_KEY);
  if (!reloadFlag) {
    sessionStorage.setItem(BUILD_CACHE_RELOADED_KEY, "true");
    window.location.replace(withDeployRefreshParam(window.location.href));
    throw new Error("[Bootstrap] Reloading after cache reset");
  }
}

function showRecoveryFallback() {
  const fails = Number(sessionStorage.getItem("boot-fails") || "0") + 1;
  sessionStorage.setItem("boot-fails", String(fails));

  const copy = staleDeployRecoveryCopy({
    mode: fails >= 2 ? "manual" : "ready",
  });

  paintRecoveryShell(copy, {
    onPrimary: async () => {
      showUpdatingSplash();
      await clearAppCaches();
      clearStaleDeployRecoveryMarks();
      window.location.replace(withDeployRefreshParam(window.location.href));
    },
    onSecondary:
      fails >= 2
        ? async () => {
            showUpdatingSplash();
            try {
              sessionStorage.clear();
              // Preserve auth tokens when possible - only clear non-auth local keys.
              const keep: Record<string, string> = {};
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
                  keep[key] = localStorage.getItem(key) || "";
                }
              }
              localStorage.clear();
              Object.entries(keep).forEach(([k, v]) => localStorage.setItem(k, v));
            } catch {
              // best-effort
            }
            await clearAppCaches();
            window.location.replace(withDeployRefreshParam(window.location.href));
          }
        : undefined,
  });
}

function appDidNotMount() {
  const root = document.getElementById("root");
  return !!root && !root.hasAttribute("data-app-mounted");
}

async function handleChunkError(): Promise<boolean> {
  return recoverFromStaleDeploy("chunk-load");
}

window.addEventListener("app:stale-deploy-recover", ((event: CustomEvent) => {
  const source = String(event?.detail?.source || "event");
  void recoverFromStaleDeploy(source).then((recovered) => {
    if (!recovered) showRecoveryFallback();
  });
}) as EventListener);

window.addEventListener("error", (event) => {
  if (isChunkLoadError(event.error || event.message)) {
    void handleChunkError();
    return;
  }
  console.error("[Bootstrap] Unhandled error:", event.error || event.message);
  captureException(event.error || new Error(event.message), { source: "window.error" });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const msg = String(reason?.message || reason || "");
  // Benign race while a waiting SW activates after skipWaiting / cache reset.
  if (/Only the active worker can claim clients/i.test(msg)) {
    event.preventDefault?.();
    return;
  }
  if (isChunkLoadError(reason)) {
    event.preventDefault?.();
    void handleChunkError();
    return;
  }
  console.error("[Bootstrap] Unhandled rejection:", reason);
  captureException(reason, { source: "window.unhandledrejection" });
});

async function bootstrap() {
  mark("beforeEnsureFreshBuild");
  await ensureFreshBuild();
  mark("afterEnsureFreshBuild");

  try {
    mark("beforeInitializeCapacitorPlugins");
    await initializeCapacitorPlugins();
    mark("afterInitializeCapacitorPlugins");
  } catch (e) {
    console.error("[Bootstrap] Capacitor init failed, continuing without native plugins:", e);
  }

  mark("beforeGetRootElement");
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("[Bootstrap] Missing root element");
  }
  mark("afterGetRootElement");

  mark("beforeImportReactDOMAndApp");
  const [{ createRoot }, { default: App }] = await Promise.all([
    import("react-dom/client"),
    import("./App.tsx"),
  ]);
  mark("afterImportReactDOMAndApp");

  mark("beforeRenderApp");
  createRoot(rootElement).render(<App />);
  rootElement.setAttribute("data-app-mounted", "true");
  // Clear any leftover HTML bootstrap splash (React replaces children, this is belt-and-suspenders)
  const bootSplash = document.getElementById("boot-splash");
  bootSplash?.remove();
  clearStaleDeployRecoveryMarks();
  scheduleAnalyticsAndObservability();
  mark("afterRenderApp");

  window.setTimeout(() => {
    if (appDidNotMount()) {
      console.error("[Bootstrap] App did not mount within 10 seconds");
      void (async () => {
        if (await recoverFromStaleDeploy("mount-timeout")) return;
        showRecoveryFallback();
      })();
    }
  }, 10000);
  mark("afterSetupTimeout");
}

bootstrap()
  .then(() => {
    mark("bootstrapFinished");
    const start = perfMarks["start"];
    const finish = perfMarks["bootstrapFinished"];
    if (start && finish) {
      console.log("[Perf] Bootstrap total time:", (finish - start).toFixed(0), "ms");
      console.log(
        "[Perf] Timestamps:",
        JSON.stringify(
          Object.fromEntries(Object.entries(perfMarks).map(([k, v]) => [k, v.toFixed(0)])),
          null,
          2,
        ),
      );
    }
  })
  .catch(async (e) => {
    if (String(e).includes("Reloading after cache reset")) return;
    console.error("[Bootstrap] Fatal error:", e);
    captureException(e, { source: "bootstrap" });
    initObservability();
    if (isChunkLoadError(e) || /Failed to fetch|Importing a module/i.test(String(e))) {
      if (await recoverFromStaleDeploy("bootstrap-import")) return;
    }
    showRecoveryFallback();
  });
