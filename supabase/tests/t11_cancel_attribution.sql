\set ON_ERROR_STOP on
truncate attributions, couples, participants, forced_attributions;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333'),
  ('Dave',  '44444444-4444-4444-8444-444444444444'),
  ('Eve',   '55555555-5555-4555-8555-555555555555');

insert into couples (participant_a_id, participant_b_id)
select a.id, b.id from participants a, participants b
where a.name = 'Alice' and b.name = 'Bob';

-- Tirage normal : Alice -> Carol.
insert into attributions (giver_id, target_id)
select a.id, c.id from participants a, participants c
where a.name = 'Alice' and c.name = 'Carol';

select test_assert(
  (select count(*) = 1 from attributions),
  'setup: one attribution before cancel');

-- Annulation : la ligne disparaît.
do $$
begin
  perform admin_cancel_attribution((select id from participants where name = 'Alice'));
end $$;

select test_assert(
  (select count(*) = 0 from attributions),
  'cancel removes the attribution');

-- Alice repasse « pas encore tiré » et Carol retourne dans la réserve.
select test_assert(
  (select not exists (select 1 from attributions a
     join participants p on p.id = a.giver_id where p.name = 'Alice')),
  'the giver is undrawn again');
select test_assert(
  (select c.id not in (select target_id from attributions) from participants c where c.name = 'Carol'),
  'the target is back in the reserve');

-- La même cible peut de nouveau être tirée : aucune règle « pas deux fois la
-- même cible » au-delà de la vie de l'attribution — après annulation, tirer
-- Carol à nouveau est accepté (l'unicité ne porte que sur les lignes vivantes).
do $$
begin
  insert into attributions (giver_id, target_id)
  select a.id, c.id from participants a, participants c
  where a.name = 'Alice' and c.name = 'Carol';
end $$;
select test_assert(
  (select count(*) = 1 from attributions,
     participants g, participants t
     where g.id = attributions.giver_id and g.name = 'Alice'
       and t.id = attributions.target_id and t.name = 'Carol'),
  'the cancelled target can be drawn again');

-- Annulation d'une attribution inexistante : PNOAT.
do $$
declare v_state text;
begin
  begin
    perform admin_cancel_attribution((select id from participants where name = 'Dave'));
    raise exception using errcode = 'TFAIL', message = 'cancel of a missing attribution must fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state is distinct from 'PNOAT' then
      raise exception using errcode = 'TFAIL', message = 'expected PNOAT, got ' || v_state;
    end if;
  end;
end $$;

-- PSOLZ : le garde-fou refuse quand l'annulation fait émerger l'impasse
-- structurelle. Avant annulation l'état est SOLVABLE : les membres du couple
-- {Alice, Carol} sont séparés (Alice a déjà tiré -> tireur, Carol est cible) ;
-- Carol peut tirer Zeb et Zeb Alice. En annulant Alice->Carol, le couple est à
-- nouveau tout entier dans les tireurs ET dans la réserve, n=3 -> impasse
-- (ADR-0001) : l'annulation est refusée (PSOLZ), la transaction et le DELETE
-- sont annulés.
truncate attributions, couples, participants, forced_attributions;

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Carol', '22222222-2222-4222-8222-222222222222'),
  ('Zeb',   '33333333-3333-4333-8333-333333333333');

insert into couples (participant_a_id, participant_b_id)
select a.id, c.id from participants a, participants c
where a.name = 'Alice' and c.name = 'Carol';

select test_assert(
  (select giver_id = (select id from participants where name = 'Alice')
    from admin_force_attribution(
      (select id from participants where name = 'Alice'),
      (select id from participants where name = 'Carol'))),
  'setup: a forced couple draw (Alice -> Carol)');
select test_assert(
  (select draw_state_is_solvable()),
  'setup: the state is solvable before the cancellation');

do $$
declare v_state text;
begin
  begin
    perform admin_cancel_attribution((select id from participants where name = 'Alice'));
    raise exception using errcode = 'TFAIL', message = 'unsolvable cancel must be rejected';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state is distinct from 'PSOLZ' then
      raise exception using errcode = 'TFAIL', message = 'expected PSOLZ, got ' || v_state;
    end if;
  end;
end $$;

select test_assert(
  (select count(*) = 1 from attributions),
  'a rejected cancel leaves the attribution in place');

-- Annuler une attribution forcée emporte la trace.
truncate attributions, couples, participants, forced_attributions;
insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333'),
  ('Dave',  '44444444-4444-4444-8444-444444444444');

insert into couples (participant_a_id, participant_b_id)
select a.id, b.id from participants a, participants b
where a.name = 'Alice' and b.name = 'Bob';

-- Forcé : Alice -> Bob (malgré leur couple), puis annulé.
do $$
begin
  perform admin_force_attribution(
    (select id from participants where name = 'Alice'),
    (select id from participants where name = 'Bob'));
end $$;

select test_assert(
  (select count(*) = 1 from forced_attributions),
  'setup: a forced draw is tracked');

do $$
begin
  perform admin_cancel_attribution((select id from participants where name = 'Alice'));
end $$;

select test_assert(
  (select count(*) = 0 from forced_attributions),
  'cancelling a forced attribution removes its trace');

-- Réservé à la service role.
begin;
set role anon;
do $$
begin
  begin
    perform admin_cancel_attribution((select id from participants where name = 'Alice'));
    raise exception using errcode = 'TFAIL', message = 'anon must not cancel an attribution';
  exception when insufficient_privilege then
    null;
  end;
end $$;
rollback;
