-- Forçage de couple (ticket #6) : le dernier recours quand le tirage est bloqué
-- (impasse structurelle, ADR-0001). L'admin force une attribution qui viole un
-- couple ; le participant ne doit jamais voir que la règle a été forcée.
--
-- La table attributions est lisible par les participants via RLS (chacun voit
-- sa propre ligne) : une colonne `forced` y fuirait le secret. Le forçage est
-- donc porté par une table dédiée, invisible pour les participants, que les
-- vues admin joignent. La colonne est rattachée à l'attribution par sa clé
-- primaire : si l'attribution saute (annulation, retrait), la trace suit.

create table if not exists forced_attributions (
  attribution_id uuid primary key references attributions (id) on delete cascade,
  created_at     timestamptz not null default now()
);

alter table forced_attributions enable row level security;

-- Par défaut, aucun SELECT n'est octroyé au rôle concerné : la table est
-- réservée à la service role (bypass RLS), comme les autres vues admin. Le
-- revoke explicite neutralise aussi les GRANT par défaut de Supabase.
revoke all on forced_attributions from public, anon, authenticated;

-- Forcer une attribution malgré un couple. Ne vérifie que la structure : le
-- couple doit bien exister (on ne force pas n'importe quoi), le tireur ne doit
-- pas déjà avoir tiré, la cible ne doit pas déjà être une cible. L'appréciation
-- « aucun tirage valide n'existe » est celle de l'admin, juge de la partie.
create or replace function admin_force_attribution(p_giver_id uuid, p_target_id uuid)
returns attributions
language plpgsql
security definer
as $$
declare
  v_result attributions%rowtype;
begin
  if p_giver_id is null or p_target_id is null then
    raise exception using errcode = 'PMISS', message = 'tireur et cible requis';
  end if;
  if p_giver_id = p_target_id then
    raise exception using errcode = 'PSELF', message = 'impossible de s''offrir à soi-même';
  end if;
  if not exists (select 1 from participants where id = p_giver_id)
     or not exists (select 1 from participants where id = p_target_id) then
    raise exception using errcode = 'PUNKN', message = 'participant inconnu';
  end if;
  if not couple_between(p_giver_id, p_target_id) then
    raise exception using errcode = 'PFORC', message = 'pas un couple';
  end if;
  if exists (select 1 from attributions where giver_id = p_giver_id) then
    raise exception using errcode = 'PDRAW', message = 'déjà tiré';
  end if;
  if exists (select 1 from attributions where target_id = p_target_id) then
    raise exception using errcode = 'PTAKN', message = 'déjà tirée comme cible';
  end if;

  insert into attributions (giver_id, target_id)
  values (p_giver_id, p_target_id)
  returning * into v_result;

  insert into forced_attributions (attribution_id) values (v_result.id);

  return v_result;
end
$$;

-- La vue admin expose le forçage (« tirage forcé : X a tiré Y (son couple) »).
-- La colonne `forced` n'atteint jamais les participants : la vue est réservée à
-- la service role, et forced_attributions est hors de portée de la RLS.
create or replace view admin_attributions as
select
  p_giver.name  as giver,
  p_target.name as target,
  (fa.attribution_id is not null) as forced
from attributions a
join participants p_giver  on p_giver.id  = a.giver_id
join participants p_target on p_target.id = a.target_id
left join forced_attributions fa on fa.attribution_id = a.id;

grant execute on function admin_force_attribution(uuid, uuid) to service_role;
revoke execute on function admin_force_attribution(uuid, uuid) from public, anon, authenticated;
grant select on admin_attributions to service_role;