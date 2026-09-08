\set ON_ERROR_STOP on
truncate attributions, couples, participants, forced_attributions;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333'),
  ('Dave',  '44444444-4444-4444-8444-444444444444');

insert into couples (participant_a_id, participant_b_id)
select a.id, b.id from participants a, participants b
where a.name = 'Alice' and b.name = 'Bob';

-- Tirage normal + un tirage forcé : traces en place avant le reset.
insert into attributions (giver_id, target_id)
select a.id, c.id from participants a, participants c
where a.name = 'Alice' and c.name = 'Carol';

do $$
begin
  perform admin_force_attribution(
    (select id from participants where name = 'Bob'),
    (select id from participants where name = 'Alice'));
end $$;

select test_assert(
  (select count(*) = 2 from attributions),
  'setup: two attributions before the reset');
select test_assert(
  (select count(*) = 1 from forced_attributions),
  'setup: a forced draw is tracked before the reset');

-- Reset « nouvelle partie » : les attributions (et leurs traces de forçage,
-- partielles via la cascade) sautent.
do $$
begin
  perform admin_reset_game();
end $$;

select test_assert(
  (select count(*) = 0 from attributions),
  'reset empties the attributions');
select test_assert(
  (select count(*) = 0 from forced_attributions),
  'reset removes the forced-draw traces too');

-- Les participants et les couples sont conservés.
select test_assert(
  (select count(*) = 4 from participants),
  'reset keeps the participants');
select test_assert(
  (select count(*) = 1 from couples),
  'reset keeps the couples');

-- Tout le monde repasse « pas encore tiré » et la réserve est pleine.
select test_assert(
  ((select count(*) from admin_player_status where has_drawn) = 0),
  'after reset no one has drawn');
select test_assert(
  (select count(*) = 0 from admin_attributions),
  'the admin view shows no attribution after the reset');

-- La partie est rejouable : un nouveau tirage complet déroule sans blocage.
do $$
declare
  r attributions%rowtype;
begin
  r := draw('11111111-1111-4111-8111-111111111111');
  r := draw('22222222-2222-4222-8222-222222222222');
  r := draw('33333333-3333-4333-8333-333333333333');
  r := draw('44444444-4444-4444-8444-444444444444');
end $$;
select test_assert(
  (select count(*) = 4 from attributions),
  'the game can be played again after the reset');

-- Idempotence : resetter une partie déjà vide reste sans effet et ne casse rien.
do $$
begin
  perform admin_reset_game();
end $$;
select test_assert(
  (select count(*) = 4 from participants),
  'a second reset keeps the participants');

-- Réservé à la service role.
begin;
set role anon;
do $$
begin
  begin
    perform admin_reset_game();
    raise exception using errcode = 'TFAIL', message = 'anon must not reset the game';
  exception when insufficient_privilege then
    null;
  end;
end $$;
rollback;