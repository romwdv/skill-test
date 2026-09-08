-- Vues admin (ticket #2) : l'aperçu de l'état de la partie (qui a tiré, qui
-- reste) alimente la console admin — critère « l'admin voit un aperçu de
-- l'état de la partie ». Réservées à la service role : aucun GRANT à
-- anon/authenticated, l'accès passe donc par bypass RLS (l'admin, jamais le
-- participant). Le tirage côté Cible/Jeu n'expose pas ces vues.

create or replace view admin_game_state as
select
  (select count(*) from participants)  as total,
  (select count(*) from attributions)  as drawn,
  (select count(*) from participants)
    - (select count(*) from attributions) as remaining;

create or replace view admin_player_status as
select
  p.id,
  p.name,
  exists (select 1 from attributions a where a.giver_id = p.id) as has_drawn
from participants p;

-- « l'admin peut voir toutes les attributions » : qui offre à qui. Même
-- cloisonnement que les autres vues : service role uniquement.
create or replace view admin_attributions as
select
  p_giver.name  as giver,
  p_target.name as target
from attributions a
join participants p_giver  on p_giver.id  = a.giver_id
join participants p_target on p_target.id = a.target_id;

grant select on admin_game_state, admin_player_status, admin_attributions to service_role;