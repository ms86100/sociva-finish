const fs = require('fs');
const raw = fs.readFileSync(
  'C:/Users/thech/.cursor/projects/c-Users-thech-OneDrive-Desktop-Sociva-finish-sociva-v1-main-sociva-v1-main/agent-tools/d188818b-bdb9-4af0-9229-2973ec3383c2.txt',
  'utf8'
);
const j = JSON.parse(raw);
let lints = j.lints;
if (!lints && typeof j.result === 'string') {
  try {
    const p = JSON.parse(j.result);
    lints = p.lints || p;
  } catch {
    // unwrap MCP envelope
    const start = j.result.indexOf('{');
    if (start >= 0) {
      try {
        const p = JSON.parse(j.result.slice(start));
        lints = p.lints || p;
      } catch {}
    }
  }
}
if (!lints && j.result && j.result.lints) lints = j.result.lints;
if (!Array.isArray(lints)) {
  console.log('keys', Object.keys(j));
  console.log('result type', typeof j.result);
  console.log(String(j.result).slice(0, 800));
  process.exit(1);
}
const by = {};
const levels = {};
for (const x of lints) {
  by[x.name] = (by[x.name] || 0) + 1;
  levels[x.level] = (levels[x.level] || 0) + 1;
}
console.log('count', lints.length);
console.log('levels', levels);
console.log('by name', Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25));
const interesting = [
  'auth_rls_initplan',
  'unindexed_foreign_keys',
  'multiple_permissive_policies',
  'duplicate_index',
  'unused_index',
];
for (const name of interesting) {
  const items = lints.filter((x) => x.name === name);
  console.log('\n==', name, items.length, '==');
  for (const x of items.slice(0, 12)) {
    console.log('-', x.level, x.title || '', (x.detail || '').slice(0, 200));
  }
}
