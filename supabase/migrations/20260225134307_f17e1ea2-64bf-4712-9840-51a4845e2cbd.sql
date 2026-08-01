
INSERT INTO public.platform_features (feature_key, feature_name, description, tagline, is_core, category, route, icon_name, audience, capabilities)
VALUES
  ('trust_score', 'Society Trust Score', 'A weighted 0-10 trust score based on Vibrancy, Transparency, Governance, and Community dimensions. Benchmarks your society against platform averages.', 'Know how your society ranks', false, 'governance', '/society', 'Shield', ARRAY['Residents', 'Committee', 'Builder'], ARRAY['Weighted trust score calculation', 'Multi-dimension breakdown (Vibrancy, Transparency, Governance, Community)', 'Platform benchmark comparison', 'Trust badge on society dashboard']),
  ('monthly_report_card', 'Monthly Report Card', 'Auto-generated transparency report summarizing financial, construction, and governance data each month. Includes interactive charts and PDF export.', 'Transparency at a glance', false, 'governance', '/society/reports', 'BarChart3', ARRAY['Residents', 'Committee', 'Builder'], ARRAY['Auto-generated monthly transparency report', 'Income vs expense breakdown', 'Construction progress summary', 'Governance health metrics', 'PDF export'])
ON CONFLICT (feature_key) DO NOTHING;
