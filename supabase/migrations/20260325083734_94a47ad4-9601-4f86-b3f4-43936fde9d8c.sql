CREATE UNIQUE INDEX IF NOT EXISTS uq_proximity_notif_per_order
ON public.notification_queue (user_id, type, reference_path)
WHERE type IN ('delivery_proximity_imminent', 'delivery_proximity')
  AND status = 'pending';