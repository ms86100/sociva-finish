import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Store hours are defined in IST; pin the test timezone so date-based
// assertions are deterministic across machines/CI.
process.env.TZ = process.env.TZ || "Asia/Kolkata";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    reporters: ["default", "./src/test/supabase-reporter.ts"],
    env: { TZ: "Asia/Kolkata" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
