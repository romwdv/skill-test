-- Schema initial de Secret Santa (ticket #1).
-- Le tirage s'effectue via la fonction draw() ; les écritures directes sont exclues
-- par RLS. L'admin accède à tout via la service role (bypass RLS) ; chaque participant
-- est identifié par le claim app_metadata.link de son JWT (le lien privé vaut identité).

create table if not exists participants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  link       uuid not null unique,
  created_at timestamptz not null default now()
);

alter table participants enable row level security;

create table if not exists couples (
  id                 uuid primary key default gen_random_uuid(),
  participant_a_id   uuid not null references participants (id) on delete cascade,
  participant_b_id   uuid not null references participants (id) on delete cascade,
  created_at         timestamptz not null default now(),
  constraint couples_no_self check (participant_a_id <> participant_b_id)
);

-- La paire est symétrique : (A,B) et (B,A) désignent le même couple. L'index
-- fonctionnel garantit l'unicité de la paire quel que soit l'ordre d'insertion.
create unique index if not exists couples_unique_pair
  on couples (least(participant_a_id, participant_b_id), greatest(participant_a_id, participant_b_id));

create index if not exists couples_participant_a on couples (participant_a_id);
create index if not exists couples_participant_b on couples (participant_b_id);

alter table couples enable row level security;

create table if not exists attributions (
  id         uuid primary key default gen_random_uuid(),
  giver_id   uuid not null unique references participants (id) on delete cascade,
  target_id  uuid not null unique references participants (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint attributions_no_self check (giver_id <> target_id)
);

-- Chaque participant ne peut être cible qu'une seule fois (cible unique) et ne tire
-- qu'une seule fois (tireur unique) : c'est la contrainte qui rend deux tirages
-- simultanés impossibles à corrompre.

alter table attributions enable row level security;

-- Tirage : choisit une cible dans la réserve, atomiquement. Un verrou advisory
-- transactionnel sérialise les tirages : deux tirages simultanés s'exécutent l'un
-- après l'autre, chacun voyant les attributions du précédent. La contrainte
-- d'unicité sur attributions.target_id reste le garde-fou : jamais deux tirages
-- simultanés sur la même cible.
create or replace function draw(p_link uuid)
returns attributions
language plpgsql
security definer
as $$
declare
  v_giver  participants%rowtype;
  v_target participants%rowtype;
  v_result attributions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('secret_santa_draw', 0));

  select * into v_giver from participants where link = p_link;
  if not found then
    raise exception using errcode = 'PLINK', message = 'lien inconnu';
  end if;

  if exists (select 1 from attributions where giver_id = v_giver.id) then
    raise exception using errcode = 'PDRAW', message = 'déjà tiré';
  end if;

  select p.* into v_target
  from participants p
  where p.id <> v_giver.id
    and not exists (select 1 from attributions a where a.target_id = p.id)
    and not exists (
      select 1 from couples c
      where least(c.participant_a_id, c.participant_b_id) = least(v_giver.id, p.id)
        and greatest(c.participant_a_id, c.participant_b_id) = greatest(v_giver.id, p.id)
    )
  order by random()
  limit 1;
  -- NB : le choix avide solvable d'ADR-0001 (garantie qu'un tirage valide existe
  -- toujours, jamais de « aucune cible valide ») arrive avec le ticket #5.

  if not found then
    raise exception using errcode = 'PNONE', message = 'aucune cible valide';
  end if;

  insert into attributions (giver_id, target_id)
  values (v_giver.id, v_target.id)
  returning * into v_result;

  return v_result;
end
$$;

grant execute on function draw(uuid) to anon, authenticated;

-- Supabase octroie par défaut SELECT aux rôles anon/authenticated sur les tables
-- publiques : c'est la RLS qui filtre. Les écritures passent uniquement par draw()
-- (aucun GRANT insert/update/delete sur les tables).
grant select on participants, couples, attributions to anon, authenticated;

-- Le lien privé vaut identité : PostgREST place le claim app_metadata.link du JWT
-- dans request.jwt.claims à chaque requête. La RLS s'en sert pour reconnaître le
-- participant courant. L'admin passe par la service role (bypass RLS).
create or replace function current_participant_link() returns uuid
language sql stable
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims'), '')::jsonb -> 'app_metadata' ->> 'link',
    ''
  )::uuid;
$$;

create or replace function current_participant_id() returns uuid
language sql stable security definer
as $$
  select id from participants where link = current_participant_link();
$$;

-- Un participant lit sa propre ligne (son nom) ; les autres noms sont invisibles.
create policy participants_select_self on participants
  for select to authenticated
  using (link = current_participant_link());

-- Le titulaire d'une attribution lit aussi le nom de sa cible (« tu offres à Y »).
-- La sous-requête passe par la RLS d'attributions : seules les cibles de SES
-- propres attributions sont visibles. La cible, elle, ne voit jamais qui la tire.
create policy participants_select_own_targets on participants
  for select to authenticated
  using (id in (select target_id from attributions where giver_id = current_participant_id()));

-- Le titulaire d'une attribution lit « X offre à Y » ; la cible ne voit jamais
-- qui la tire (surprise préservée). L'admin lit tout via la service role.
create policy attributions_select_own on attributions
  for select to authenticated
  using (giver_id = current_participant_id());

-- couples : aucune lecture côté participant ; réservé à l'admin (service role).