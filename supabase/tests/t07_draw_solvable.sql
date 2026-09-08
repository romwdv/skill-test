\set ON_ERROR_STOP on
truncate attributions, couples, participants, forced_attributions;
\i :tests/lib/assertions.sql

-- Invariants vérifiés après un tirage complet.
create or replace function check_completed_draw(p_expected int) returns void
language plpgsql
as $$
begin
  perform test_assert((select count(*) from attributions) = p_expected,
    'every participant drew exactly once');
  perform test_assert(
    (select count(distinct target_id) = count(*) from attributions),
    'a drawn target leaves the reserve');
  perform test_assert(not exists (
    select 1 from attributions a
    join couples c on least(c.participant_a_id, c.participant_b_id) = least(a.giver_id, a.target_id)
                  and greatest(c.participant_a_id, c.participant_b_id) = greatest(a.giver_id, a.target_id)
  ), 'no draw assigns a couple partner');
  perform test_assert(not exists (
    select 1 from attributions where giver_id = target_id
  ), 'no draw assigns the giver themself');
end $$;

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333'),
  ('Dave',  '44444444-4444-4444-8444-444444444444');

insert into couples (participant_a_id, participant_b_id)
select p1.id, p2.id from participants p1, participants p2
where p1.name = 'Alice' and p2.name = 'Bob';

-- Le choix avide solvable (ticket #5, ADR-0001) : la cible choisie doit garder
-- un tirage valide possible. Tirer le dernier célibataire laisse le couple
-- {Alice,Bob} seul face à une réserve sans issue ; tirer un membre du couple,
-- non.
do $$
declare
  alice uuid := (select id from participants where name = 'Alice');
  bob   uuid := (select id from participants where name = 'Bob');
  carol uuid := (select id from participants where name = 'Carol');
  dave  uuid := (select id from participants where name = 'Dave');
begin
  perform test_assert(not draw_keeps_solvable(carol, dave),
    'Carol drawing Dave leaves the couple {Alice,Bob} without a valid draw');
  perform test_assert(not draw_keeps_solvable(dave, carol),
    'Dave drawing Carol leaves the couple {Alice,Bob} without a valid draw');
  perform test_assert(draw_keeps_solvable(carol, alice),
    'Carol drawing Alice keeps the sub-problem solvable');
  perform test_assert(draw_keeps_solvable(carol, bob),
    'Carol drawing Bob keeps the sub-problem solvable');
end $$;

-- Tirage complet, maintes fois, dans la configuration la plus piégeuse pour un
-- choix naïf (un couple + deux célibataires, n = 4) : le tirage ne s'enlise
-- jamais et respecte toujours couples, non-soi et réserve.
do $$
declare
  r attributions%rowtype;
  i int;
begin
  for i in 1..40 loop
    truncate attributions, couples, participants, forced_attributions;
    insert into participants (name, link) values
      ('Alice', '11111111-1111-4111-8111-111111111111'),
      ('Bob',   '22222222-2222-4222-8222-222222222222'),
      ('Carol', '33333333-3333-4333-8333-333333333333'),
      ('Dave',  '44444444-4444-4444-8444-444444444444');
    insert into couples (participant_a_id, participant_b_id)
    select p1.id, p2.id from participants p1, participants p2
    where p1.name = 'Alice' and p2.name = 'Bob';

    perform setseed(0.01 * i);

    r := draw('11111111-1111-4111-8111-111111111111');
    r := draw('22222222-2222-4222-8222-222222222222');
    r := draw('33333333-3333-4333-8333-333333333333');
    r := draw('44444444-4444-4444-8444-444444444444');

    perform check_completed_draw(4);
  end loop;
end $$;

-- La frontière délicate : un CÉLIBATAIRE tire le premier, alors que le couple
-- est encore tout entier dans la réserve (le choix avide doit ne pas tirer
-- l'autre célibataire). Même configuration, ordre de tirage différent.
do $$
declare
  r attributions%rowtype;
  i int;
begin
  for i in 1..20 loop
    truncate attributions, couples, participants, forced_attributions;
    insert into participants (name, link) values
      ('Alice', '11111111-1111-4111-8111-111111111111'),
      ('Bob',   '22222222-2222-4222-8222-222222222222'),
      ('Carol', '33333333-3333-4333-8333-333333333333'),
      ('Dave',  '44444444-4444-4444-8444-444444444444');
    insert into couples (participant_a_id, participant_b_id)
    select p1.id, p2.id from participants p1, participants p2
    where p1.name = 'Alice' and p2.name = 'Bob';

    perform setseed(0.01 * (40 + i));

    r := draw('33333333-3333-4333-8333-333333333333');
    r := draw('44444444-4444-4444-8444-444444444444');
    r := draw('11111111-1111-4111-8111-111111111111');
    r := draw('22222222-2222-4222-8222-222222222222');

    perform check_completed_draw(4);
  end loop;
end $$;

-- Même garantie avec deux couples + un célibataire (n = 5).
do $$
declare
  r attributions%rowtype;
  i int;
begin
  for i in 1..20 loop
    truncate attributions, couples, participants, forced_attributions;
    insert into participants (name, link) values
      ('Alice', '11111111-1111-4111-8111-111111111111'),
      ('Bob',   '22222222-2222-4222-8222-222222222222'),
      ('Carol', '33333333-3333-4333-8333-333333333333'),
      ('Dave',  '44444444-4444-4444-8444-444444444444'),
      ('Eve',   '55555555-5555-4555-8555-555555555555');
    insert into couples (participant_a_id, participant_b_id)
    select p1.id, p2.id from participants p1, participants p2
    where (p1.name = 'Alice' and p2.name = 'Bob')
       or (p1.name = 'Carol' and p2.name = 'Dave');

    perform setseed(0.01 * (70 + i));

    r := draw('11111111-1111-4111-8111-111111111111');
    r := draw('22222222-2222-4222-8222-222222222222');
    r := draw('33333333-3333-4333-8333-333333333333');
    r := draw('44444444-4444-4444-8444-444444444444');
    r := draw('55555555-5555-4555-8555-555555555555');

    perform check_completed_draw(5);
  end loop;
end $$;

-- Les couples sont respectés TANT QU'UN tirage valide existe : quand aucun
-- tirage valide n'existe (un couple sans assez de monde autour), draw() lève
-- PNONE dès le premier tirage, sans jamais créer une attribution invalide.
truncate attributions, couples, participants, forced_attributions;
insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333');
insert into couples (participant_a_id, participant_b_id)
select p1.id, p2.id from participants p1, participants p2
where p1.name = 'Alice' and p2.name = 'Bob';

do $$
declare
  r attributions%rowtype;
begin
  begin
    r := draw('11111111-1111-4111-8111-111111111111');
    raise exception using errcode = 'TFAIL',
      message = 'expected PNONE: a couple + 1 single has no valid draw';
  exception when sqlstate 'PNONE' then
    perform test_assert(r.giver_id is null, 'no attribution was created');
  end;
end $$;

truncate attributions, couples, participants, forced_attributions;
insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222');
insert into couples (participant_a_id, participant_b_id)
select p1.id, p2.id from participants p1, participants p2
where p1.name = 'Alice' and p2.name = 'Bob';

do $$
declare
  r attributions%rowtype;
begin
  begin
    r := draw('11111111-1111-4111-8111-111111111111');
    raise exception using errcode = 'TFAIL',
      message = 'expected PNONE: a couple alone can never draw';
  exception when sqlstate 'PNONE' then
    perform test_assert(r.giver_id is null, 'no attribution was created');
  end;
end $$;

truncate attributions, couples, participants, forced_attributions;
insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111');

do $$
declare
  r attributions%rowtype;
begin
  begin
    r := draw('11111111-1111-4111-8111-111111111111');
    raise exception using errcode = 'TFAIL',
      message = 'expected PNONE: one participant cannot draw themself';
  exception when sqlstate 'PNONE' then
    perform test_assert(r.giver_id is null, 'no attribution was created');
  end;
end $$;