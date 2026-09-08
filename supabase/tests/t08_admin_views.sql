\set ON_ERROR_STOP on
truncate attributions, couples, participants;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333'),
  ('Dave',  '44444444-4444-4444-8444-444444444444');

-- État initial : personne n'a tiré.
select test_assert(
  (select total = 4 and drawn = 0 and remaining = 4 from admin_game_state),
  '0 draws: total 4, drawn 0, remaining 4');
select test_assert(
  (select count(*) from admin_player_status where not has_drawn) = 4,
  '0 draws: every participant still undrawn');

-- Après un tirage (Alice -> Bob) : la réserve et les compteurs bougent.
insert into attributions (giver_id, target_id)
select a.id, b.id from participants a, participants b
where a.name = 'Alice' and b.name = 'Bob';

select test_assert(
  (select total = 4 and drawn = 1 and remaining = 3 from admin_game_state),
  '1 draw: total 4, drawn 1, remaining 3');
select test_assert(
  (select count(*) from admin_player_status where has_drawn) = 1,
  '1 draw: exactly one giver marked drawn');
select test_assert(
  (select has_drawn from admin_player_status where name = 'Alice'),
  '1 draw: Alice has drawn');
select test_assert(
  (select count(*) from admin_player_status where name <> 'Alice' and has_drawn) = 0,
  '1 draw: no one else has drawn');
select test_assert(
  (select giver = 'Alice' and target = 'Bob' from admin_attributions),
  '1 draw: the admin sees who offers to whom');
select test_assert(
  (select count(*) from admin_attributions) = 1,
  '1 draw: exactly one attribution is visible');

-- Les vues ne sont PAS destinées aux rôles anon/authenticated : rien n'est
-- lisible. L'admin passe par la service role (comme en production).
begin;
set role anon;
do $$
begin
  begin
    perform count(*) from admin_game_state;
    raise exception using errcode = 'TFAIL', message = 'anon must not read admin_game_state';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform count(*) from admin_player_status;
    raise exception using errcode = 'TFAIL', message = 'anon must not read admin_player_status';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform count(*) from admin_attributions;
    raise exception using errcode = 'TFAIL', message = 'anon must not read admin_attributions';
  exception when insufficient_privilege then
    null;
  end;
end $$;
rollback;

begin;
set role authenticated;
do $$
begin
  begin
    perform count(*) from admin_game_state;
    raise exception using errcode = 'TFAIL', message = 'authenticated must not read admin_game_state';
  exception when insufficient_privilege then
    null;
  end;
end $$;
rollback;