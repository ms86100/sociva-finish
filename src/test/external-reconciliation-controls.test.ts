import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260808150000_external_reconciliation_safe_controls.sql",
  ),
  "utf8",
);

function functionDefinition(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION ${name}`;
  const start = migration.indexOf(marker);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const next = migration.indexOf("\nCREATE OR REPLACE FUNCTION ", start + marker.length);
  return migration.slice(start, next === -1 ? migration.length : next);
}

describe("external reconciliation control contract", () => {
  it("installs every reconciliation capability default-off", () => {
    for (const gate of [
      "reconciliation_projection_enabled",
      "provider_statement_ingest_enabled",
      "bank_statement_ingest_enabled",
      "reconciliation_matching_enabled",
      "reconciliation_replay_enabled",
    ]) {
      expect(migration).toContain(`('${gate}', false,`);
    }
  });

  it("keeps the projection stable, database-only, and write-free", () => {
    const projection = functionDefinition(
      "public.get_reconciliation_projection",
    );

    expect(projection).toContain("STABLE");
    expect(projection).toContain(
      "finance.reconciliation_gate('reconciliation_projection_enabled')",
    );
    expect(projection).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|MERGE|CALL|PERFORM)\b/i,
    );
    expect(projection).not.toMatch(/\b(fetch|http|net\.)\b/i);
  });

  it("uses independent gates for supplied provider and bank evidence", () => {
    const beginImport = functionDefinition(
      "public.begin_financial_statement_import",
    );
    const providerIngest = functionDefinition(
      "public.ingest_provider_statement_rows",
    );
    const bankIngest = functionDefinition(
      "public.ingest_bank_statement_rows",
    );

    expect(beginImport).toContain("'provider_statement_ingest_enabled'");
    expect(beginImport).toContain("'bank_statement_ingest_enabled'");
    expect(providerIngest).toContain(
      "finance.reconciliation_gate('provider_statement_ingest_enabled')",
    );
    expect(bankIngest).toContain(
      "finance.reconciliation_gate('bank_statement_ingest_enabled')",
    );
  });

  it("gates matching and replay separately and schedules no worker", () => {
    expect(
      functionDefinition("public.run_external_reconciliation_matching"),
    ).toContain(
      "finance.reconciliation_gate('reconciliation_matching_enabled')",
    );
    expect(
      functionDefinition("public.request_statement_dead_letter_replay"),
    ).toContain(
      "finance.reconciliation_gate('reconciliation_replay_enabled')",
    );
    expect(migration).not.toMatch(/\bcron\.schedule\s*\(/i);
  });
});
