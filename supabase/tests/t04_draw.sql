\set ON_ERROR_STOP on
truncate attributions, couples, participants;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333'),
  ('Dave',  '44444444-4444-4444-8444-444444444444');

insert into couples (participant_a_id, participant_b_id)
select p1.id, p2.id from participants p1, participants p2
where p1.name = 'Alice' and p2.name = 'Bob';

do $$
declare
  r attributions%rowtype;
  alice uuid := (select id from participants where name = 'Alice');
  bob   uuid := (select id from participants where name = 'Bob');
  carol uuid := (select id from participants where name = 'Carol');
  dave  uuid := (select id from participants where name = 'Dave');
begin
  r := draw('11111111-1111-4111-8111-111111111111');

  perform test_assert(r.giver_id = alice, 'draw records the giver');
  perform test_assert(r.target_id <> alice, 'a participant never draws themself');
  perform test_assert(r.target_id <> bob, 'couples are respected: Alice never draws Bob');

  begin
    r := draw('11111111-1111-4111-8111-111111111111');
    raise exception using errcode = 'TFAIL', message = 'expected PDRAW: Alice already drew';
  exception when sqlstate 'PDRAW' then
    null;
  end;

  r := draw('22222222-2222-4222-8222-222222222222');
  perform test_assert(r.target_id <> bob, 'Bob never draws themself');
  perform test_assert(r.target_id <> alice, 'couples are respected: Bob never draws Alice');

  r := draw('33333333-3333-4333-8333-333333333333');
  r := draw('44444444-4444-4444-8444-444444444444');

  perform test_assert((select count(*) from attributions) = 4, 'everyone drew exactly once');
  perform test_assert(
    (select count(distinct target_id) = count(*) from attributions),
    'no target is given to two givers');
end $$;

do $$
declare
  r attributions%rowtype;
begin
  r := draw('99999999-9999-4999-8999-999999999999');
  raise exception using errcode = 'TFAIL', message = 'expected PLINK for unknown link';
exception when sqlstate 'PLINK' then
  null;
end $$;