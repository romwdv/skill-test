-- Annulation d'attribution (ticket #7) : l'admin défait un tirage. La cible
-- retourne dans la réserve, le tireur redevient « pas encore tiré » et peut
-- retirer au sort — la même personne peut de nouveau être tirée (il n'existe
-- aucune règle « pas deux fois la même cible » : seule l'unicité de la cible
-- tant qu'elle est tirée compte). Si l'attribution était forcée (#6), la trace
-- (table forced_attributions, on delete cascade) saute avec elle.

-- Solvabilité de l'état complet : un assignement valide (chaque tireur restant
-- une cible distincte, sans soi ni couple) existe-t-il ? Avec des couples
-- disjoints (ADR-0001), la condition structurelle de draw_keeps_solvable posée
-- sur tout l'état est exacte : n >= 4 toujours solvable, n <= 2 vérification
-- directe des appariements, n = 3 seule impasse possible, un couple dont les
-- deux membres sont encore tout entiers dans les tireurs ET dans la réserve.
-- Les tailles des ensembles tireurs et cibles restantes restent égales : chaque
-- tirage retire exactement un tireur et une cible de la réserve.
create or replace function draw_state_is_solvable() returns boolean
language plpgsql
security definer
as $$
declare
  v_n  int;
  v_gs uuid[];
  v_ts uuid[];
begin
  v_n := (select count(*) from participants p where not exists (
    select 1 from attributions a where a.giver_id = p.id));

  if v_n = 0 or v_n >= 4 then
    return true;
  end if;

  v_gs := (select array_agg(p.id) from participants p where not exists (
    select 1 from attributions a where a.giver_id = p.id));
  v_ts := (select array_agg(p.id) from participants p where not exists (
    select 1 from attributions a where a.target_id = p.id));

  if v_n = 1 then
    return v_gs[1] is distinct from v_ts[1] and not couple_between(v_gs[1], v_ts[1]);
  end if;

  if v_n = 2 then
    return (v_gs[1] is distinct from v_ts[1] and not couple_between(v_gs[1], v_ts[1])
        and v_gs[2] is distinct from v_ts[2] and not couple_between(v_gs[2], v_ts[2]))
        or (v_gs[1] is distinct from v_ts[2] and not couple_between(v_gs[1], v_ts[2])
        and v_gs[2] is distinct from v_ts[1] and not couple_between(v_gs[2], v_ts[1]));
  end if;

  -- n = 3 : un couple {a,b} encore tout entier dans les tireurs restants ET
  -- tout entier dans la réserve met la partie dans l'impasse structurelle de
  -- l'ADR-0001 (forcée ensuite par l'admin, ticket #6).
  return not exists (
    select 1 from couples c
    where not exists (select 1 from attributions a where a.giver_id = c.participant_a_id)
      and not exists (select 1 from attributions a where a.giver_id = c.participant_b_id)
      and not exists (select 1 from attributions a where a.target_id = c.participant_a_id)
      and not exists (select 1 from attributions a where a.target_id = c.participant_b_id)
  );
end $$;

-- Helper interne : les participants ne doivent pas pouvoir sonder la
-- solvabilité via la fonction.
revoke execute on function draw_state_is_solvable() from public, anon, authenticated;

-- Annuler l'attribution du tireur donné : la cible retourne dans la réserve,
-- le tireur repasse « pas encore tiré ». L'annulation vérifie que la partie
-- reste solvable : remettre un membre de couple du côté des tireurs ET de la
-- réserve peut faire réapparaître l'impasse structurelle (un couple dont les
-- deux membres sont tout entiers dans les tireurs et dans la réserve, n=3,
-- ADR-0001). C'est le cas réel couvert par PSOLZ : l'annulation est refusée et
-- la transaction (donc le DELETE et la trace de forçage) est annulée — l'admin
-- force alors un tirage (#6) ou laisse l'attribution en place.
create or replace function admin_cancel_attribution(p_giver_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_att attributions%rowtype;
begin
  if p_giver_id is null then
    raise exception using errcode = 'PMISS', message = 'tireur requis';
  end if;

  select * into v_att from attributions where giver_id = p_giver_id;
  if not found then
    raise exception using errcode = 'PNOAT', message = 'aucune attribution à annuler';
  end if;

  -- Suppression puis vérification : en PL/pgSQL la vérification fait partie de
  -- la même transaction, donc sur PSOLZ le DELETE (et la trace de forçage qui
  -- part en cascade) est annulé avec elle.
  delete from attributions where giver_id = p_giver_id;

  if not draw_state_is_solvable() then
    raise exception using errcode = 'PSOLZ',
      message = 'l''annulation rendrait la partie insolvable';
  end if;
end
$$;

-- La vue admin expose l'id du tireur pour permettre l'annulation depuis la
-- console (la colonne reste réservée à la service role, jamais aux participants).
create or replace view admin_attributions as
select
  p_giver.name  as giver,
  p_target.name as target,
  (fa.attribution_id is not null) as forced,
  a.giver_id,
  a.target_id
from attributions a
join participants p_giver  on p_giver.id  = a.giver_id
join participants p_target on p_target.id = a.target_id
left join forced_attributions fa on fa.attribution_id = a.id;

grant execute on function admin_cancel_attribution(uuid) to service_role;
revoke execute on function admin_cancel_attribution(uuid) from public, anon, authenticated;
grant select on admin_attributions to service_role;
