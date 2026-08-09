const fs = require("fs");
const path = require("path");
const args = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "_mcp_deploy_pnq_args.json"),
    "utf8",
  ),
);
// Emit to stdout as a single JSON for MCP (caller will pipe)
process.stdout.write(JSON.stringify({
  project_id: args.project_id,
  name: args.name,
  entrypoint_path: "functions/process-notification-queue/index.ts",
  verify_jwt: false,
  files: args.files,
}));
