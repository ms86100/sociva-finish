const fs = require("fs");
const args = JSON.parse(fs.readFileSync(".tmp-fn-deploy/_apply_ready.json", "utf8"));
// Emit for MCP: write query to stdout marker file that agent will use
process.stdout.write(JSON.stringify({
  project_id: args.project_id,
  name: args.name,
  query_chars: args.query.length,
  query_sha256: require("crypto").createHash("sha256").update(args.query).digest("hex"),
}));
