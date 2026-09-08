-- Accès participant par lien (ticket #4). Le lien privé vaut identité : l'Edge
-- Function participant-access émet une session (JWT) qui porte le lien, et
-- participant-view lit la vue personnelle strictement par ce lien. Cette RPC
-- security definer ne renvoie donc que la ligne du participant courant — il ne
-- voit jamais les attributions des autres. Un lien régénéré (nouvel UUID) ne
-- retrouve plus la ligne → 401 : l'ancien lien cesse de donner accès.

create or replace function participant_view(p_link uuid)
returns table (id uuid, name text, has_drawn boolean, target_name text)
language sql
security definer
stable
as $$
  select
    p.id,
    p.name,
    (a.giver_id is not null) as has_drawn,
    t.name as target_name
  from participants p
  left join attributions a on a.giver_id = p.id
  left join participants t on t.id = a.target_id
  where p.link = p_link;
$$;

-- Réservée à la service role : le participant passe par l'Edge Function, qui
-- vérifie sa session. Comme les RPC admin, aucune exécution directe publique.
grant execute on function participant_view(uuid) to service_role;
revoke execute on function participant_view(uuid) from public, anon, authenticated;