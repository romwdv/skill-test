\set ON_ERROR_STOP on
truncate attributions, couples, participants, forced_attributions;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333');

do $$
declare
  alice uuid := (select id from participants where name = 'Alice');
  bob   uuid := (select id from participants where name = 'Bob');
  carol uuid := (select id from participants where name = 'Carol');
begin
  insert into attributions (giver_id, target_id) values (alice, bob);
  insert into attributions (giver_id, target_id) values (bob, carol);

  begin
    insert into attributions (giver_id, target_id) values (alice, carol);
    raise exception using errcode = 'TFAIL',
      message = 'expected unique_violation: a participant cannot be giver twice';
  exception when unique_violation then
    null;
  end;

  begin
    insert into attributions (giver_id, target_id) values (carol, bob);
    raise exception using errcode = 'TFAIL',
      message = 'expected unique_violation: a participant cannot be target twice';
  exception when unique_violation then
    null;
  end;

  begin
    insert into attributions (giver_id, target_id) values (carol, carol);
    raise exception using errcode = 'TFAIL',
      message = 'expected check_violation: a participant cannot be their own target';
  exception when check_violation then
    null;
  end;

  begin
    insert into attributions (giver_id, target_id) values (carol, '99999999-9999-4999-8999-999999999999');
    raise exception using errcode = 'TFAIL',
      message = 'expected foreign_key_violation for unknown target';
  exception when foreign_key_violation then
    null;
  end;
end $$;

select test_assert((select count(*) from attributions) = 2, 'only valid attributions were stored');