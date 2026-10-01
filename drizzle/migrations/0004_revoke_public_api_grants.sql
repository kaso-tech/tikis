-- ─── Droits de l'API publique : aussi pour les tables créées après 0001 ─────────────────────────
-- 0001 a retiré à anon et authenticated les droits sur les tables existantes, mais Supabase accorde
-- par défaut tous les droits sur chaque nouvelle table (ALTER DEFAULT PRIVILEGES) : la table de 0002,
-- tikisse_scheduled_job_runs, les avait récupérés. Sans effet tant que la RLS est active, mais une
-- seule barrière ne suffit pas. On retire ces droits, et on empêche les prochaines tables d'en hériter.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    -- tikisse_delivery_channel_members (supabase/realtime_auth_phone_rls.sql) garde ses propres droits.
    EXECUTE (
      SELECT coalesce(string_agg(format('REVOKE ALL ON TABLE public.%I FROM authenticated', tablename), '; '), 'SELECT 1')
      FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'tikisse_delivery_channel_members'
    );
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated';
  END IF;
END;
$$;
