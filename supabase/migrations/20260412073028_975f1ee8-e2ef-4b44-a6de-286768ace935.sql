SELECT cron.schedule(
  'check-support-sla',
  '*/15 * * * *',
  'SELECT public.fn_check_support_sla()'
);