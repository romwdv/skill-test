-- Nouvelle partie (ticket #8) : le bouton admin « Nouvelle partie » remet à
-- zéro les attributions et la réserve, mais conserve les participants et les
-- couples. C'est le point de départ d'une nouvelle année.
--
-- La réserve n'est pas une table : c'est l'ensemble des participants non
-- désignés comme cibles. Vider attributions remet donc tout le monde « pas
-- encore tiré » et reconstitue une réserve pleine. Les traces de forçage (#6)
-- partent en cascade avec les attributions (clé étrangère on delete cascade) ;
-- les participants et les couples ne sont pas touchés.

create or replace function admin_reset_game()
returns void
language sql
security definer
as $$
  delete from attributions;
$$;

grant execute on function admin_reset_game() to service_role;
revoke execute on function admin_reset_game() from public, anon, authenticated;