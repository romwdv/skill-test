\set ON_ERROR_STOP on
truncate attributions, couples, participants;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333');

-- Attribution déterministe : Alice a tiré Bob.
insert into attributions (giver_id, target_id)
select a.id, b.id from participants a, participants b
where a.name = 'Alice' and b.name = 'Bob';

-- Le titulaire (Alice) lit son attribution ET le nom de sa cible.
begin;
do $$ begin perform set_config(
  'request.jwt.claims',
  '{"app_metadata":{"link":"11111111-1111-4111-8111-111111111111"}}',
  true);
end $$;
set role authenticated;
select test_assert((select count(*) from attributions) = 1,
  'the holder reads their attribution');
select test_assert(
  (select count(*) from attributions a join participants p on p.id = a.giver_id
    where p.name = 'Alice') = 1,
  'the visible attribution is the holder''s own');
select test_assert(
  (select count(*) from participants p
     join attributions a on p.id = a.target_id where p.name = 'Bob') = 1,
  'the holder reads their target''s name (« tu offres à Y »)');
select test_assert((select count(*) from participants) = 2,
  'the holder sees their own row and their target''s name, nothing else');
select test_assert((select count(*) from couples) = 0,
  'couples are never visible to participants');
rollback;

-- La cible (Bob) ne voit jamais qui la tire.
begin;
do $$ begin perform set_config(
  'request.jwt.claims',
  '{"app_metadata":{"link":"22222222-2222-4222-8222-222222222222"}}',
  true);
end $$;
set role authenticated;
select test_assert((select count(*) from attributions) = 0,
  'the target never sees who drew them');
select test_assert((select count(*) from participants) = 1,
  'the target reads only their own row');
rollback;

-- Un participant sans attribution ne voit aucune attribution.
begin;
do $$ begin perform set_config(
  'request.jwt.claims',
  '{"app_metadata":{"link":"33333333-3333-4333-8333-333333333333"}}',
  true);
end $$;
set role authenticated;
select test_assert((select count(*) from attributions) = 0,
  'a participant who did not draw sees no attribution');
rollback;

-- Sans JWT (anon), rien n'est lisible.
begin;
set role anon;
select test_assert((select count(*) from attributions) = 0,
  'anon sees no attributions');
select test_assert((select count(*) from participants) = 0,
  'anon sees no participants');
select test_assert((select count(*) from couples) = 0,
  'anon sees no couples');
rollback;

-- L'admin (service role, bypass RLS) lit tout.
select test_assert((select count(*) from attributions) = 1,
  'the admin reads all attributions');
select test_assert((select count(*) from participants) = 3,
  'the admin reads all participants');

-- Un participant tire via draw() avec le rôle authenticated : la chaîne
-- security definer (draw -> draw_keeps_solvable -> couple_between) doit rester
-- fonctionnelle malgré la révocation d'exécution sur les helpers.
truncate attributions, couples, participants;
insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333'),
  ('Dave',  '44444444-4444-4444-8444-444444444444');
insert into couples (participant_a_id, participant_b_id)
select p1.id, p2.id from participants p1, participants p2
where p1.name = 'Alice' and p2.name = 'Bob';

begin;
do $$ begin perform set_config(
  'request.jwt.claims',
  '{"app_metadata":{"link":"33333333-3333-4333-8333-333333333333"}}',
  true);
end $$;
set role authenticated;
select test_assert(
  (select count(*) from draw('33333333-3333-4333-8333-333333333333')) = 1,
  'a participant draws through RLS');
select test_assert(
  (select count(*) from attributions
    where giver_id = (select id from participants where link = '33333333-3333-4333-8333-333333333333')) = 1,
  'Carol''s draw is recorded');
rollback;