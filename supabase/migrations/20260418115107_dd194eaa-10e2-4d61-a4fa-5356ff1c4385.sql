GRANT ALL ON public.notification_rules TO service_role;
GRANT ALL ON public.notification_templates TO service_role;
GRANT ALL ON public.notification_state_tracker TO service_role;
GRANT ALL ON public.notification_engine_runs TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_render_template(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_from_rule(uuid, uuid, uuid, jsonb, text) TO service_role;