const fs = require('fs');
const parts = [];
for (let i = 0; i < 7; i++) {
  parts.push(fs.readFileSync(`.tmp-fn-deploy/_e2e_ins_${i}.sql`, 'utf8'));
}
// Write a combined JSON array of queries for the agent
fs.writeFileSync('.tmp-fn-deploy/_e2e_all_ins.json', JSON.stringify(parts));
console.log('combined', parts.length, parts.reduce((a, b) => a + b.length, 0));
