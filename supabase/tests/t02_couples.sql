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