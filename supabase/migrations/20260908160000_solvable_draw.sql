-- Tirage solvable (ticket #5) : le choix avide d'ADR-0001.
-- À chaque tirage, draw() choisit une cible qui garde le sous-problème solvable
-- (un tirage valide reste possible pour tous les tireurs restants). Le critère
-- est exact grâce à la structure des interdits — chaque tireur n'interdit que
-- lui-même et au plus son conjoint — et à la disjonction des couples, imposée
-- ici par le déclencheur couples_disjoint :
--   * n >= 4 tireurs restants : un tirage valide existe toujours (la condition
--     de Hall n'est jamais violée), aucune cible ne peut enliser le jeu ;
--   * n = 3 : seule impasse possible, un couple dont les deux membres sont
--     encore tireurs ET encore dans la réserve ;
--   * n <= 2 : vérification directe des appariements possibles.
-- PNONE n'est donc levé que lorsqu'aucun tirage valide n'existe réellement
-- (impasse structurelle, ex. un couple sans assez de participants) ; l'admin
-- force alors un tirage malgré le couple (ADR-0001). La note « arrive avec le
-- ticket #5 » de la migration initiale est donc soldée.

create or replace function couple_between(p_a uuid, p_b uuid) returns boolean
language sql stable security definer
as $$
  select exists (
    select 1 from couples c
    where least(c.participant_a_id, c.participant_b_id) = least(p_a, p_b)
      and greatest(c.participant_a_id, c.participant_b_id) = greatest(p_a, p_b)
  );
$$;

-- Helper interne : les participants ne doivent pas pouvoir sonder les couples
-- via la fonction (la table leur est invisible par RLS).
revoke execute on function couple_between(uuid, uuid) from public, anon, authenticated;

create or replace function draw_keeps_solvable(p_giver uuid, p_target uuid)
returns boolean
language plpgsql
security definer
as $$
declare
  v_n  int;
  v_gs uuid[];
  v_ts uuid[];
begin
  -- Tireurs restants après ce tirage (== cibles restantes : chaque tirage
  -- retire exactement un tireur et une cible de la réserve).
  v_n := (
    select count(*)
    from participants p
    where p.id <> p_giver
      and not exists (select 1 from attributions a where a.giver_id = p.id)
  );

  if v_n = 0 or v_n >= 4 then
    return true;
  end if;

  -- Tireurs et cibles restants, pour les cas n <= 3.
  v_gs := (select array_agg(p.id) from participants p
           where p.id <> p_giver
             and not exists (select 1 from attributions a where a.giver_id = p.id));
  v_ts := (select array_agg(p.id) from participants p
           where p.id <> p_target
             and not exists (select 1 from attributions a where a.target_id = p.id));

  if v_n = 1 then
    return v_gs[1] is distinct from v_ts[1] and not couple_between(v_gs[1], v_ts[1]);
  end if;

  if v_n = 2 then
    return (v_gs[1] is distinct from v_ts[1] and not couple_between(v_gs[1], v_ts[1])
        and v_gs[2] is distinct from v_ts[2] and not couple_between(v_gs[2], v_ts[2]))
        or (v_gs[1] is distinct from v_ts[2] and not couple_between(v_gs[1], v_ts[2])
        and v_gs[2] is distinct from v_ts[1] and not couple_between(v_gs[2], v_ts[1]));
  end if;

  -- n = 3 : seule impasse possible, un couple {a,b} encore tout entier dans les
  -- tireurs restants ET tout entier dans la réserve.
  return not exists (
    select 1 from couples c
    where c.participant_a_id <> p_giver
      and c.participant_b_id <> p_giver
      and c.participant_a_id <> p_target
      and c.participant_b_id <> p_target
      and not exists (select 1 from attributions a where a.giver_id = c.participant_a_id)
      and not exists (select 1 from attributions a where a.giver_id = c.participant_b_id)
      and not exists (select 1 from attributions a where a.target_id = c.participant_a_id)
      and not exists (select 1 from attributions a where a.target_id = c.participant_b_id)
  );
end $$;

revoke execute on function draw_keeps_solvable(uuid, uuid) from public, anon, authenticated;

create or replace function draw(p_link uuid)
returns attributions
language plpgsql
security definer
as $$
declare
  v_giver  participants%rowtype;
  v_target participants%rowtype;
  v_result attributions%rowtype;
  v_candidates uuid[];
  v_t uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('secret_santa_draw', 0));

  select * into v_giver from participants where link = p_link;
  if not found then
    raise exception using errcode = 'PLINK', message = 'lien inconnu';
  end if;

  if exists (select 1 from attributions where giver_id = v_giver.id) then
    raise exception using errcode = 'PDRAW', message = 'déjà tiré';
  end if;

  -- Réserve, dans un ordre aléatoire. Le choix avide solvable garde le
  -- sous-problème solvable : si un tirage valide existe, on le trouve ; sinon
  -- (impasse structurelle), PNONE — l'admin force alors un tirage.
  select array_agg(p.id order by random()) into v_candidates
  from participants p
  where p.id <> v_giver.id
    and not exists (select 1 from attributions a where a.target_id = p.id)
    and not couple_between(v_giver.id, p.id);

  if v_candidates is not null then
    foreach v_t in array v_candidates loop
      if draw_keeps_solvable(v_giver.id, v_t) then
        select * into v_target from participants where id = v_t;
        exit;
      end if;
    end loop;
  end if;

  if v_target.id is null then
    raise exception using errcode = 'PNONE', message = 'aucune cible valide';
  end if;

  insert into attributions (giver_id, target_id)
  values (v_giver.id, v_target.id)
  returning * into v_result;

  return v_result;
end
$$;

grant execute on function draw(uuid) to anon, authenticated;

-- Couples disjoints (ADR-0001) : un participant ne peut être que dans un seul
-- couple ; la garantie de solvabilité du tirage repose dessus. Une paire en
-- miroir (B,A) n'est pas interceptée ici : l'index couples_unique_pair la
-- rejette avec unique_violation (testé dans t02).
create or replace function couples_disjoint_check() returns trigger
language plpgsql
security definer
as $$
begin
  -- Une paire (X,X) est laissée à la contrainte couples_no_self (les BEFORE
  -- triggers passent avant les CHECK) ; une paire en miroir (B,A), à l'index
  -- couples_unique_pair. Ici : tout partage d'UN SEUL membre avec un couple
  -- existant, soit un vrai chevauchement.
  if new.participant_a_id <> new.participant_b_id and exists (
    select 1 from couples c
    where (c.participant_a_id = new.participant_a_id and c.participant_b_id <> new.participant_b_id)
       or (c.participant_a_id = new.participant_b_id and c.participant_b_id <> new.participant_a_id)
       or (c.participant_b_id = new.participant_a_id and c.participant_a_id <> new.participant_b_id)
       or (c.participant_b_id = new.participant_b_id and c.participant_a_id <> new.participant_a_id)
  ) then
    raise exception using errcode = 'CDISJ', message = 'couples disjoints requis';
  end if;
  return new;
end $$;

create trigger couples_disjoint
  before insert or update on couples
  for each row execute function couples_disjoint_check();