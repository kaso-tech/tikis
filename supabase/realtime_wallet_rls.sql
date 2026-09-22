-- Tikis Realtime — canal Wallet : exécuter dans Supabase SQL Editor, à la suite de
-- realtime_auth_phone_rls.sql (ne pas exécuter via l'API Management : Supabase protège le schéma
-- realtime).
--
-- Plus simple que le canal de livraison : un canal Wallet appartient toujours à exactement
-- l'utilisateur dont il porte l'id dans son nom (`wallet:<user_id>`), jamais à personne d'autre —
-- pas de table d'adhésion à tenir à jour comme pour les livraisons (sender + driver).
--
-- Seul le serveur publie sur ce canal, avec la clé de service (server/supabase-realtime.ts,
-- publishWalletBroadcast) — qui contourne RLS. Ce fichier n'autorise donc que la RÉCEPTION.

drop policy if exists "Tikis profile receives own wallet broadcasts" on realtime.messages;
create policy "Tikis profile receives own wallet broadcasts"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() = 'wallet:' || (select auth.uid())::text
);
