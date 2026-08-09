const fs = require("fs");
const args = JSON.parse(
  fs.readFileSync(".tmp-fn-deploy/_mig_stamp_args.json", "utf8")
);
process.stdout.write(JSON.stringify(args));
