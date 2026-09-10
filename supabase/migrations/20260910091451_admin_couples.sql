-- Gestion des couples côté admin (ticket #11). L'admin indique qui ne peut
-- pas tirer qui : une paire symétrique, deux participants distincts, disjoints
-- (ADR-0001). Les contraintes de la table couples (couples_no_self,
-- couples_unique_pair, couples_disjoint) font le travail ; les RPC ci-dessous
-- exposent l'ajout et la suppression à la console admin via la service role.

-- Ajouter un couple (A,B) : la paire est symétrique, l'ordre n'a pas
-- d'importance. Une paire existante (dans un sens ou l'autre) est ignorée
-- silencieusement (ON CONFLICT DO NOTHING) ; l'auto-couple et le partage d'un
-- membre avec un couple existant sont rejetés par les contraintes.
create or replace function admin_add_couple(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
as $$
begin
  if p_a is null or p_b is null or p_a = p_b then
    raise exception using errcode = 'PSELF', message = 'un couple unit deux participants distincts';
  end if;
  insert into couples (participant_a_id, participant_b_id)
  values (least(p_a, p_b), greatest(p_a, p_b))
  on conflict do nothing;
end
$$;

-- Supprimer un couple : quel que soit l'ordre (la paire est symétrique).
create or replace function admin_delete_couple(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
as $$
begin
  if p_a is null or p_b is null then
    raise exception using errcode = 'PMISS', message = 'participants requis';
  end if;
  delete from couples
  where (participant_a_id, participant_b_id) = (least(p_a, p_b), greatest(p_a, p_b));
end
$$;

-- La console admin lit les couples avec les noms (pour les afficher).
create or replace view admin_couples as
select
  c.id,
  c.participant_a_id,
  c.participant_b_id,
  a.name as a_name,
  b.name as b_name
from couples c
join participants a on a.id = c.participant_a_id
join participants b on b.id = c.participant_b_id;

grant execute on function admin_add_couple(uuid, uuid) to service_role;
grant execute on function admin_delete_couple(uuid, uuid) to service_role;
grant select on admin_couples to service_role;

-- Réservées à l'admin : aucun droit d'exécution pour les rôles publics.
revoke execute on function admin_add_couple(uuid, uuid) from public, anon, authenticated;
revoke execute on function admin_delete_couple(uuid, uuid) from public, anon, authenticated;