-- Tikis Realtime: exécuter dans Supabase SQL Editor après activation de Supabase Auth Phone.
-- Ne pas exécuter via l’API Management : Supabase protège le schéma realtime.

create table if not exists public.tikis_delivery_channel_members (
  delivery_id text not null check (delivery_id ~ '^[0-9a-fA-F-]{36}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_role text not null check (participant_role in ('sender', 'driver')),
  updated_at timestamptz not null default now(),
  primary key (delivery_id, user_id)
);

alter table public.tikis_delivery_channel_members enable row level security;
grant select on public.tikis_delivery_channel_members to authenticated;

drop policy if exists "Tikis members can read own memberships" on public.tikis_delivery_channel_members;
create policy "Tikis members can read own memberships"
on public.tikis_delivery_channel_members for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Tikis delivery participants receive broadcasts" on realtime.messages;
create policy "Tikis delivery participants receive broadcasts"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1 from public.tikis_delivery_channel_members member
    where member.user_id = (select auth.uid())
      and realtime.topic() = 'delivery:' || member.delivery_id
  )
);

-- Seul le livreur assigné peut publier sa position. Les statuts sont publiés par le serveur.
drop policy if exists "Tikis assigned driver broadcasts positions" on realtime.messages;
create policy "Tikis assigned driver broadcasts positions"
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1 from public.tikis_delivery_channel_members member
    where member.user_id = (select auth.uid())
      and member.participant_role = 'driver'
      and realtime.topic() = 'delivery:' || member.delivery_id
  )
);

-- Dans Supabase Dashboard > Realtime > Settings, désactiver "Allow public access".
