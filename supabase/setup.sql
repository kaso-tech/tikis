-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Tikisse — configuration Supabase (temps réel), à exécuter UNE fois dans Supabase → SQL Editor,
-- APRÈS `pnpm db:migrate` (qui crée les tables de l'application). Rejouable sans risque.
--
-- Pourquoi l'éditeur SQL et pas une migration : ces objets vivent dans les schémas `auth` et `realtime`
-- propres à Supabase, absents d'un PostgreSQL ordinaire (base de test, développement local).
--
-- Ce que ça met en place :
--  1. qui participe à quelle livraison (table `tikisse_delivery_channel_members`, tenue à jour par le
--     serveur, server/supabase-realtime.ts) ;
--  2. canal `delivery:<id>` : seuls l'expéditeur et le livreur de la livraison reçoivent ; seul le livreur
--     publie sa position ; les statuts sont publiés par le serveur (clé service_role) ;
--  3. canal `wallet:<id utilisateur>` : seul son propriétaire reçoit ; seul le serveur publie.
--
-- Ensuite, dans Supabase → Realtime → Settings : désactiver « Allow public access ». Sans ce réglage,
-- n'importe qui pourrait écouter un canal public portant le même nom ; avec, seuls les canaux privés
-- (autorisés par les règles ci-dessous) existent.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─── 1. Participants des livraisons ─────────────────────────────────────────────────────────────
create table if not exists public.tikisse_delivery_channel_members (
  delivery_id text not null check (delivery_id ~ '^[0-9a-fA-F-]{36}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_role text not null check (participant_role in ('sender', 'driver')),
  updated_at timestamptz not null default now(),
  primary key (delivery_id, user_id)
);

alter table public.tikisse_delivery_channel_members enable row level security;
revoke all on public.tikisse_delivery_channel_members from anon;
grant select on public.tikisse_delivery_channel_members to authenticated;

drop policy if exists "Tikisse members can read own memberships" on public.tikisse_delivery_channel_members;
create policy "Tikisse members can read own memberships"
on public.tikisse_delivery_channel_members for select to authenticated
using ((select auth.uid()) = user_id);

-- ─── 2. Canal de livraison ──────────────────────────────────────────────────────────────────────
-- Anciennes règles fondées sur une revendication JWT jamais renseignée (toujours fausses) : retirées.
drop policy if exists "tikisse_delivery_members_can_receive_positions" on realtime.messages;
drop policy if exists "tikisse_delivery_members_can_send_positions" on realtime.messages;

drop policy if exists "Tikisse delivery participants receive broadcasts" on realtime.messages;
create policy "Tikisse delivery participants receive broadcasts"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1 from public.tikisse_delivery_channel_members member
    where member.user_id = (select auth.uid())
      and realtime.topic() = 'delivery:' || member.delivery_id
  )
);

drop policy if exists "Tikisse assigned driver broadcasts positions" on realtime.messages;
create policy "Tikisse assigned driver broadcasts positions"
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1 from public.tikisse_delivery_channel_members member
    where member.user_id = (select auth.uid())
      and member.participant_role = 'driver'
      and realtime.topic() = 'delivery:' || member.delivery_id
  )
);

-- ─── 3. Canal Wallet ────────────────────────────────────────────────────────────────────────────
drop policy if exists "Tikisse profile receives own wallet broadcasts" on realtime.messages;
create policy "Tikisse profile receives own wallet broadcasts"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() = 'wallet:' || (select auth.uid())::text
);
