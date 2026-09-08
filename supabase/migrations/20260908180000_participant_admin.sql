-- Gestion des participants côté admin (ticket #3). L'admin passe par la
-- service role (bypass RLS) via des RPC security definer — les participants,
-- eux, ne touchent jamais directement la table. Le lien privé vaut identité :
-- le régénérer (nouveau UUID) invalide l'ancien puisque la RLS reconnaît le
-- participant par `link`.

-- Ajouter un participant : un nom, et un lien privé (UUID v4, 128 bits
-- impossible à deviner) sont créés.
create or replace function admin_add_participant(p_name text)
returns participants
language plpgsql
security definer
as $$
declare
  v_result participants;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception using errcode = 'PNAME', message = 'nom requis';
  end if;
  insert into participants (name, link)
  values (btrim(p_name), gen_random_uuid())
  returning * into v_result;
  return v_result;
end
$$;

-- Régénérer le lien privé d'un participant : l'ancien cesse de fonctionner
-- (la RLS ne reconnaît plus le participant par l'ancien link).
create or replace function admin_regenerate_participant_link(p_id uuid)
returns participants
language sql
security definer
as $$
  update participants
  set link = gen_random_uuid()
  where id = p_id
  returning *;
$$;

-- Supprimer un participant : ses couples et ses attributions (comme tireur et
-- comme cible) partent en cascade (on delete cascade). Une cible supprimée
-- relâche le tireur, qui peut retirer au sort.
create or replace function admin_delete_participant(p_id uuid)
returns void
language sql
security definer
as $$
  delete from participants where id = p_id;
$$;

-- La console admin lit les participants avec leur lien (pour le copier) et
-- leur état. Réservée à la service role comme les autres vues admin.
create or replace view admin_participants as
select
  p.id,
  p.name,
  p.link,
  exists (select 1 from attributions a where a.giver_id = p.id) as has_drawn
from participants p;

grant execute on function admin_add_participant(text) to service_role;
grant execute on function admin_regenerate_participant_link(uuid) to service_role;
grant execute on function admin_delete_participant(uuid) to service_role;
grant select on admin_participants to service_role;

-- Réservées à l'admin : aucun droit d'exécution pour les rôles publics.
revoke execute on function admin_add_participant(text) from public, anon, authenticated;
revoke execute on function admin_regenerate_participant_link(uuid) from public, anon, authenticated;
revoke execute on function admin_delete_participant(uuid) from public, anon, authenticated;