\set ON_ERROR_STOP on
truncate attributions, couples, participants, forced_attributions;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222');

select test_assert(
  (select count(*) from participants) = 2,
  'a participant is stored with a name and a link');

select test_assert(
  (select id is not null and link = '11111111-1111-4111-8111-111111111111'
     from participants where name = 'Alice'),
  'participant row gets an id and keeps its private link');

do $$
begin
  begin
    insert into participants (name, link) values ('Carol', '11111111-1111-4111-8111-111111111111');
    raise exception using errcode = 'TFAIL',
      message = 'expected unique_violation for duplicate link, insert succeeded';
  exception when unique_violation then
    null;
  end;
end $$;

select test_assert(
  (select count(*) from participants) = 2,
  'duplicate link insert was rejected');