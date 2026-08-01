
-- Seed new system_settings keys for address labels and legal page dates
INSERT INTO system_settings (key, value) VALUES
  ('address_block_label', 'Block / Tower'),
  ('address_flat_label', 'Flat Number'),
  ('terms_last_updated', 'February 13, 2026'),
  ('privacy_last_updated', 'February 13, 2026')
ON CONFLICT (key) DO NOTHING;
