-- Nettoyage : cette policy s'appuyait sur une revendication JWT (`app_metadata.delivery_ids`) qui n'a
-- jamais été peuplée nulle part dans le code — elle n'a donc jamais réellement protégé quoi que ce soit
-- (elle s'évalue toujours à faux) et fait double emploi avec la policy réellement câblée dans
-- `realtime_auth_phone_rls.sql` (basée sur la table `public.tikis_delivery_channel_members`).
-- Faire coexister les deux est une source de confusion opérationnelle : un reviewer sécurité pourrait
-- croire cette protection JWT active alors qu'elle ne l'a jamais été.
--
-- Si ce fichier a déjà été exécuté sur le projet Supabase de production, exécuter ce script de
-- nettoyage dans Supabase SQL Editor pour la retirer. Sur un projet où il n'a jamais été appliqué,
-- ces DROP sont des no-op sûrs (IF EXISTS).

DROP POLICY IF EXISTS "tikis_delivery_members_can_receive_positions" ON realtime.messages;
DROP POLICY IF EXISTS "tikis_delivery_members_can_send_positions" ON realtime.messages;

-- Seule source de vérité RLS pour les canaux de livraison Tikis : `realtime_auth_phone_rls.sql`.
