-- Staging applied this version as ssv003_hub_isolation_seed with QA hub rows.
-- Those INSERTS are not safe to promote. Re-seed staging only via
-- scripts/staging/ssv003_hub_isolation_seed.sql
-- This file is a no-op so a later production apply does not insert fixtures.

SELECT 1;
