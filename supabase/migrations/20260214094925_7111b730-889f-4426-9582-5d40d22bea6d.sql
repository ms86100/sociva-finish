-- Fix 1: Atomic nonce deduplication via UNIQUE partial index
-- Prevents race condition where two concurrent validations both pass SELECT check
CREATE UNIQUE INDEX idx_gate_entries_nonce_unique 
ON public.gate_entries (user_id, society_id, notes) 
WHERE notes LIKE 'nonce:%';

-- Performance index for nonce lookup queries
CREATE INDEX idx_gate_entries_nonce_lookup 
ON public.gate_entries (user_id, society_id, notes text_pattern_ops) 
WHERE notes LIKE 'nonce:%';

-- Fix 2: Server-side expiry enforcement via RLS
-- Drop existing UPDATE policy and replace with temporal check
DROP POLICY IF EXISTS "Authenticated update gate entry confirmation" ON public.gate_entries;

-- Residents can only update their own entries AND only before expiry
CREATE POLICY "Residents confirm before expiry" 
ON public.gate_entries 
FOR UPDATE 
TO authenticated 
USING (
  user_id = auth.uid() 
  AND (
    -- Allow if no confirmation timeout set (basic mode entries)
    confirmation_expires_at IS NULL 
    OR confirmation_expires_at > now()
  )
);

-- Security officers and admins can always update (for admin overrides, manual corrections)
CREATE POLICY "Officers and admins update entries" 
ON public.gate_entries 
FOR UPDATE 
TO authenticated 
USING (
  is_security_officer(auth.uid(), society_id) 
  OR is_society_admin(auth.uid(), society_id)
);