const fs = require('fs');
const raw = fs.readFileSync(
  'C:/Users/thech/.cursor/projects/c-Users-thech-OneDrive-Desktop-Sociva-finish-sociva-v1-main-sociva-v1-main/agent-tools/d188818b-bdb9-4af0-9229-2973ec3383c2.txt',
  'utf8'
);
const j = JSON.parse(raw);
const lints = j.lints;
const a = lints.find((x) => x.name === 'auth_db_connections_absolute');
console.log(JSON.stringify(a, null, 2));
