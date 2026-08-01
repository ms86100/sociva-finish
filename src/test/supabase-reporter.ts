/**
 * Custom Vitest reporter that collects all test results and posts them
 * to the save-test-results edge function after the run completes.
 */
import type { Reporter, File, Task } from "vitest";

interface TestRecord {
  run_id: string;
  module_name: string;
  test_name: string;
  page_or_api_url: string | null;
  input_data: Record<string, unknown> | null;
  outcome: "passed" | "failed" | "skipped";
  duration_ms: number | null;
  response_payload: Record<string, unknown> | null;
  error_message: string | null;
  error_code: string | null;
  http_status_code: number | null;
  file_path: string;
  executed_at: string;
}

// Route mapping for page-related test modules
const MODULE_ROUTE_MAP: Record<string, string> = {
  "Landing Page": "/welcome",
  "Auth Page": "/auth",
  "Profile Page": "/profile",
  "Privacy Policy": "/privacy-policy",
  "Terms": "/terms",
  "Community Rules": "/community-rules",
  "Help": "/help",
  "Pricing": "/pricing",
  "Search Page": "/search",
  "Categories Page": "/categories",
  "Cart Page": "/cart",
  "Orders Page": "/orders",
  "Favorites": "/favorites",
  "Subscriptions": "/subscriptions",
  "Trust Directory": "/directory",
  "Become Seller": "/become-seller",
  "Seller Dashboard": "/seller",
  "Seller Products": "/seller/products",
  "Seller Settings": "/seller/settings",
  "Seller Earnings": "/seller/earnings",
  "Society Dashboard": "/society",
  "Bulletin Page": "/community",
  "Finances": "/society/finances",
  "Construction Progress": "/society/progress",
  "Snag List": "/society/snags",
  "Disputes": "/disputes",
  "Maintenance": "/maintenance",
  "Society Reports": "/society/reports",
  "Society Admin": "/society/admin",
  "Payment Milestones": "/payment-milestones",
  "Inspection": "/inspection",
  "Guard Kiosk": "/guard-kiosk",
  "Gate Entry": "/gate-entry",
  "Security Verify": "/security/verify",
  "Security Audit": "/security/audit",
  "Visitor Management": "/visitors",
  "Parcel Management": "/parcels",
  "Builder Dashboard": "/builder",
  "Builder Analytics": "/builder/analytics",
  "Worker Jobs": "/worker/jobs",
  "Worker My Jobs": "/worker/my-jobs",
  "Hire Help": "/worker-hire",
  "Create Job Request": "/worker-hire/create",
  "Domestic Help": "/domestic-help",
  "Workforce Management": "/workforce",
  "Vehicle Parking": "/parking",
  "Notifications": "/notifications",
  "Notification Inbox": "/notifications/inbox",
  "Admin Panel": "/admin",
  "Buyer Discovery E2E": "/search",
  "Admin → Seller → Buyer E2E": "/admin",
};

function getModuleName(task: Task): string {
  const names: string[] = [];
  let current: Task | undefined = task;
  while (current?.suite) {
    current = current.suite;
    if (current?.name) names.unshift(current.name);
  }
  return names[0] || "Unknown";
}

function getFullDescribe(task: Task): string {
  const names: string[] = [];
  let current: Task | undefined = task;
  while (current?.suite) {
    current = current.suite;
    if (current?.name) names.unshift(current.name);
  }
  return names.join(" > ");
}

function flattenTasks(tasks: Task[]): Task[] {
  const result: Task[] = [];
  for (const task of tasks) {
    if (task.type === "test") {
      result.push(task);
    } else if (task.type === "suite" && task.tasks) {
      result.push(...flattenTasks(task.tasks));
    }
  }
  return result;
}

export default class SupabaseReporter implements Reporter {
  private results: TestRecord[] = [];
  private runId: string;
  private executedAt: string;

  constructor() {
    this.runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.executedAt = new Date().toISOString();
  }

  onFinished(files?: File[]) {
    if (!files) return;

    for (const file of files) {
      const allTests = flattenTasks(file.tasks);
      for (const test of allTests) {
        const moduleName = getModuleName(test);
        const fullDescribe = getFullDescribe(test);
        const pageUrl = MODULE_ROUTE_MAP[moduleName] || null;

        const outcome: "passed" | "failed" | "skipped" =
          test.result?.state === "pass"
            ? "passed"
            : test.result?.state === "fail"
            ? "failed"
            : "skipped";

        const errorMsg =
          test.result?.errors?.[0]?.message ||
          test.result?.errors?.[0]?.toString() ||
          null;

        this.results.push({
          run_id: this.runId,
          module_name: moduleName,
          test_name: test.name,
          page_or_api_url: pageUrl,
          input_data: fullDescribe !== moduleName ? { describe: fullDescribe } : null,
          outcome,
          duration_ms: test.result?.duration ?? null,
          response_payload: null,
          error_message: errorMsg,
          error_code: outcome === "failed" ? "ASSERTION_ERROR" : null,
          http_status_code: null,
          file_path: file.filepath,
          executed_at: this.executedAt,
        });
      }
    }

    // Post results to edge function
    this.postResults();
  }

  private async postResults() {
    if (this.results.length === 0) return;

    const projectId = process.env.VITE_SUPABASE_PROJECT_ID;
    const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (!projectId || !anonKey) {
      console.warn(
        "\n⚠️ Skipping test-result upload — VITE_SUPABASE_PROJECT_ID / VITE_SUPABASE_PUBLISHABLE_KEY not set"
      );
      return;
    }

    const url = `https://${projectId}.supabase.co/functions/v1/save-test-results`;


    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ results: this.results }),
      });

      const data = await res.json();
      const passed = this.results.filter((r) => r.outcome === "passed").length;
      const failed = this.results.filter((r) => r.outcome === "failed").length;
      const skipped = this.results.filter((r) => r.outcome === "skipped").length;

      console.log(
        `\n📊 Test results saved to DB: ${data.inserted} records ` +
          `(✅ ${passed} passed, ❌ ${failed} failed, ⏭️ ${skipped} skipped) ` +
          `| Run ID: ${this.runId}`
      );
    } catch (err) {
      console.error("\n⚠️ Failed to save test results to DB:", err);
    }
  }
}
