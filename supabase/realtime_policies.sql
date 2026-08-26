-- Modèle à appliquer dans Supabase après la mise en place du JWT de production.
-- Le JWT doit contenir : app_metadata.delivery_ids = ["delivery_123", ...].

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tikis_delivery_members_can_receive_positions"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() LIKE 'delivery:%'
  AND split_part(realtime.topic(), ':', 2) = ANY (
    SELECT jsonb_array_elements_text(auth.jwt()->'app_metadata'->'delivery_ids')
  )
);

CREATE POLICY "tikis_delivery_members_can_send_positions"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() LIKE 'delivery:%'
  AND split_part(realtime.topic(), ':', 2) = ANY (
    SELECT jsonb_array_elements_text(auth.jwt()->'app_metadata'->'delivery_ids')
  )
);
