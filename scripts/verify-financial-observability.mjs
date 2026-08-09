const EXPECTED_PROJECT = 'kkzkuyhgdvyecmxtmkpy';
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Financial evidence prerequisite missing: ${name}`);
  return value;
};

const projectRef = required('SUPABASE_PROJECT_REF');
if (projectRef !== EXPECTED_PROJECT) throw new Error(`Refusing unexpected project ${projectRef}`);
const managementToken = required('SUPABASE_ACCESS_TOKEN');
const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const evidenceKey = required('FINANCIAL_EVIDENCE_SERVICE_KEY');
const windowStart = required('FINANCIAL_SHADOW_WINDOW_START');
const windowEnd = required('FINANCIAL_SHADOW_WINDOW_END');
if (!(new Date(windowStart) < new Date(windowEnd))) throw new Error('Invalid shadow window');

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${url}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

const managementHeaders = { Authorization: `Bearer ${managementToken}` };
const restHeaders = {
  apikey: evidenceKey,
  Authorization: `Bearer ${evidenceKey}`,
  Accept: 'application/json',
};

const [security, performance] = await Promise.all(
  ['security', 'performance'].map((kind) =>
    jsonFetch(`https://api.supabase.com/v1/projects/${projectRef}/advisors/${kind}`, {
      headers: managementHeaders,
    }),
  ),
);
const advisorRows = [security, performance].flatMap((result) =>
  Array.isArray(result) ? result : result?.lints ?? result?.advisors ?? [],
);
const advisorErrors = advisorRows.filter((row) =>
  ['error', 'critical'].includes(String(row.level ?? row.severity ?? '').toLowerCase()),
);
if (advisorErrors.length) {
  throw new Error(`Supabase advisor gate failed with ${advisorErrors.length} critical/error finding(s)`);
}

const logSql = `
select timestamp, event_message
from edge_logs
where timestamp >= '${new Date(windowStart).toISOString()}'
  and timestamp < '${new Date(windowEnd).toISOString()}'
  and lower(event_message) ~ '(wallet|financial|reconcil|settlement|payout|refund)'
  and lower(event_message) ~ '(error|fatal|panic|exception|failed)'
order by timestamp desc
limit 200`;
const logUrl = new URL(
  `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/logs.all`,
);
logUrl.searchParams.set('sql', logSql);
logUrl.searchParams.set('iso_timestamp_start', new Date(windowStart).toISOString());
logUrl.searchParams.set('iso_timestamp_end', new Date(windowEnd).toISOString());
const logs = await jsonFetch(logUrl, { headers: managementHeaders });
const logRows = Array.isArray(logs) ? logs : logs?.result ?? logs?.data ?? [];
if (logRows.length) {
  throw new Error(`Financial production log gate found ${logRows.length} error event(s)`);
}

const preflight = await jsonFetch(`${supabaseUrl}/rest/v1/rpc/financial_runtime_preflight`, {
  method: 'POST',
  headers: { ...restHeaders, 'Content-Type': 'application/json' },
  body: '{}',
});
if (preflight?.money_movement_disabled !== true) {
  throw new Error('Money movement is not fully disabled');
}
if (preflight?.reconciliation_ready !== true) {
  throw new Error('Financial reconciliation preflight is not ready');
}

async function rows(table, select, filters) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  url.searchParams.set('select', select);
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  return jsonFetch(url, { headers: restHeaders });
}

const dateStart = windowStart.slice(0, 10);
const dateEnd = windowEnd.slice(0, 10);
const [imports, providerRows, bankRows, reconciliations, exceptions] = await Promise.all([
  rows('financial_statement_imports', 'source,statement_date,status,row_count', {
    statement_date: `gte.${dateStart}`,
    and: `(statement_date.lt.${dateEnd})`,
  }),
  rows('provider_statement_rows', 'id', {
    occurred_at: `gte.${windowStart}`,
    and: `(occurred_at.lt.${windowEnd})`,
  }),
  rows('bank_statement_rows', 'id', {
    value_date: `gte.${dateStart}`,
    and: `(value_date.lt.${dateEnd})`,
  }),
  rows('financial_reconciliation_records', 'reconciliation_date,status,difference_minor', {
    reconciliation_date: `gte.${dateStart}`,
    and: `(reconciliation_date.lt.${dateEnd})`,
  }),
  rows('financial_exception_queue', 'status,severity,owner_id', {
    status: 'in.(open,investigating)',
  }),
]);

if (!imports.length || imports.some((row) => row.status !== 'completed' || row.row_count <= 0)) {
  throw new Error('Shadow parity lacks completed, non-empty statement imports');
}
if (!providerRows.length || !bankRows.length || !reconciliations.length) {
  throw new Error('Shadow parity lacks provider, bank, or reconciliation evidence');
}
if (reconciliations.some((row) => row.status !== 'matched' || Number(row.difference_minor) !== 0)) {
  throw new Error('Shadow parity contains unmatched or non-zero reconciliation variance');
}
if (exceptions.length) {
  throw new Error(`Shadow parity has ${exceptions.length} open/investigating exception(s)`);
}

console.log(JSON.stringify({
  projectRef,
  windowStart,
  windowEnd,
  advisorFindings: advisorRows.length,
  financialErrorLogs: logRows.length,
  imports: imports.length,
  providerRows: providerRows.length,
  bankRows: bankRows.length,
  reconciliations: reconciliations.length,
  openExceptions: exceptions.length,
  moneyMovementDisabled: true,
}, null, 2));
