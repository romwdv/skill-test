\set ON_ERROR_STOP on
truncate attributions, couples, participants;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222');

insert into couples (participant_a_id, participant_b_id)
select p1.id, p2.id from participants p1, participants p2
where p1.name = 'Alice' and p2.name = 'Bob';

select test_assert((select count(*) from couples) = 1, 'couple pair stored');

do $$
declare
  alice uuid := (select id from participants where name = 'Alice');
  bob   uuid := (select id from participants where name = 'Bob');
begin
  begin
    insert into couples (participant_a_id, participant_b_id) values (bob, alice);
    raise exception using errcode = 'TFAIL',
      message = 'expected unique_violation for reversed pair, insert succeeded';
  exception when unique_violation then
    null;
  end;

  begin
    insert into couples (participant_a_id, participant_b_id) values (alice, alice);
    raise exception using errcode = 'TFAIL',
      message = 'expected check_violation for self-pair, insert succeeded';
  exception when check_violation then
    null;
  end;
end $$;

select test_assert((select count(*) from couples) = 1, 'only the canonical pair remains');

-- Les couples sont des paires disjointes (ADR-0001) : la garantie de
-- solvabilité du tirage (ticket #5) repose dessus. Un participant ne peut donc
-- appartenir qu'à un seul couple.
insert into participants (name, link) values
  ('Carol', '33333333-3333-4333-8333-333333333333');

do $$
declare
  alice uuid := (select id from participants where name = 'Alice');
  bob   uuid := (select id from participants where name = 'Bob');
  carol uuid := (select id from participants where name = 'Carol');
begin
  begin
    insert into couples (participant_a_id, participant_b_id) values (alice, carol);
    raise exception using errcode = 'TFAIL',
      message = 'expected CDISJ: Alice is already coupled, insert succeeded';
  exception when sqlstate 'CDISJ' then
    null;
  end;

  begin
    insert into couples (participant_a_id, participant_b_id) values (carol, alice);
    raise exception using errcode = 'TFAIL',
      message = 'expected CDISJ: Alice is already coupled (order swapped), insert succeeded';
  exception when sqlstate 'CDISJ' then
    null;
  end;

  begin
    update couples
       set participant_a_id = carol, participant_b_id = alice
     where participant_a_id = alice and participant_b_id = bob;
    raise exception using errcode = 'TFAIL',
      message = 'expected CDISJ: updating a couple cannot overlap another';
  exception when sqlstate 'CDISJ' then
    null;
  end;
end $$;

select test_assert((select count(*) from couples) = 1,
  'overlapping couples are rejected, the canonical pair remains');