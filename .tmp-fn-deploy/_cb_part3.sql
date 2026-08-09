-- ============================================================
-- C3: Dedupe + UNIQUE on seller_conversations
-- ============================================================
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY buyer_id, seller_id, product_id
           ORDER BY COALESCE(last_message_at, created_at) DESC NULLS LAST, created_at DESC
         ) AS rn
  FROM seller_conversations
)
DELETE FROM seller_conversation_messages m
USING ranked r
WHERE m.conversation_id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY buyer_id, seller_id, product_id
           ORDER BY COALESCE(last_message_at, created_at) DESC NULLS LAST, created_at DESC
         ) AS rn
  FROM seller_conversations
)
DELETE FROM seller_conversations sc
USING ranked r
WHERE sc.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_conversations_buyer_seller_product
  ON public.seller_conversations (buyer_id, seller_id, product_id);