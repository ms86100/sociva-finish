#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const after = process.argv[2] || '0';
const limit = Number(process.argv[3] || '0') || Infinity;
const dir = path.join(__dirname, 'staging-migs');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.wrapped.sql'))
  .map((f) => ({
    version: f.replace(/\.wrapped\.sql$/, ''),
    file: path.join(dir, f),
    size: fs.statSync(path.join(dir, f)).size,
  }))
  .filter((x) => x.version > after)
  .sort((a, b) => a.version.localeCompare(b.version))
  .slice(0, limit);
console.log(JSON.stringify(files, null, 2));
