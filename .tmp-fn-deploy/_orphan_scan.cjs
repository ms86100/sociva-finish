const fs = require('fs');
const path = require('path');
const root = path.join(process.cwd(), 'src');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'test' || e.name === 'node_modules') continue;
      walk(p, acc);
    } else if (
      /\.(ts|tsx)$/.test(e.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(e.name) &&
      !e.name.includes('FROZEN') &&
      !e.name.endsWith('.d.ts')
    ) {
      acc.push(p);
    }
  }
  return acc;
}

const files = walk(root);
const contents = new Map();
for (const f of files) contents.set(f, fs.readFileSync(f, 'utf8'));

const importRe = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;

function resolveImport(fromFile, spec) {
  if (spec.startsWith('@/')) {
    return path.normalize(path.join(root, spec.slice(2)));
  }
  if (spec.startsWith('.')) {
    return path.normalize(path.join(path.dirname(fromFile), spec));
  }
  return null;
}

function existsModule(base) {
  const cands = [
    base,
    base + '.ts',
    base + '.tsx',
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const c of cands) if (contents.has(c)) return c;
  return null;
}

const entries = [path.join(root, 'main.tsx'), path.join(root, 'App.tsx')];
const queue = [...entries];
const reachable = new Set(entries);

while (queue.length) {
  const cur = queue.shift();
  const text = contents.get(cur);
  if (!text) continue;
  importRe.lastIndex = 0;
  let m;
  while ((m = importRe.exec(text))) {
    const resolved = resolveImport(cur, m[1]);
    if (!resolved) continue;
    const hit = existsModule(resolved);
    if (hit && !reachable.has(hit)) {
      reachable.add(hit);
      queue.push(hit);
    }
  }
}

const orphans = files.filter((f) => !reachable.has(f));
const byDir = {};
for (const o of orphans) {
  const rel = path.relative(root, o).split(path.sep).join('/');
  const top = rel.split('/')[0];
  (byDir[top] ||= []).push(rel);
}

console.log('TOTAL_FILES', files.length);
console.log('REACHABLE', reachable.size);
console.log('ORPHANS', orphans.length);
for (const k of Object.keys(byDir).sort()) {
  const v = byDir[k].sort();
  console.log('---', k, v.length);
  for (const x of v) console.log(x);
}
