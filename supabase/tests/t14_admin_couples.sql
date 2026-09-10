\set ON_ERROR_STOP on
truncate attributions, couples, participants, forced_attributions;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333'),
  ('Dave',  '44444444-4444-4444-8444-444444444444');

do $$
declare
  alice uuid := (select id from participants where name = 'Alice');
  bob   uuid := (select id from participants where name = 'Bob');
begin
  -- L'ordre des uuid n'a pas d'importance : la paire est stockée une seule fois,
  -- dans un ordre canonique. Peu importe quel côté est a et quel côté est b.
  perform admin_add_couple(bob, alice);
  perform test_assert(
    (select count(*) from couples) = 1
    and (select count(*) from admin_couples
         where (a_name = 'Alice' and b_name = 'Bob')
            or (a_name = 'Bob' and b_name = 'Alice')) = 1,
    'admin_add_couple stores the symmetric pair once');
end $$;

do $$
declare
  alice uuid := (select id from participants where name = 'Alice');
  bob   uuid := (select id from participants where name = 'Bob');
begin
  -- Ajouter deux fois la même paire (même ordre) est idempotent.
  perform admin_add_couple(alice, bob);
  perform test_assert((select count(*) from couples) = 1,
    'admin_add_couple on an existing pair is a no-op');
end $$;

do $$
declare
  alice uuid := (select id from participants where name = 'Alice');
begin
  begin
    perform admin_add_couple(alice, alice);
    raise exception using errcode = 'TFAIL', message = 'expected PSELF for self-pair, insert succeeded';
  exception when sqlstate 'PSELF' then
    null;
  end;
end $$;

do $$
declare
  alice uuid := (select id from participants where name = 'Alice');
  carol uuid := (select id from participants where name = 'Carol');
begin
  begin
    perform admin_add_couple(alice, carol);
    raise exception using errcode = 'TFAIL', message = 'expected CDISJ: Alice is already coupled';
  exception when sqlstate 'CDISJ' then
    null;
  end;
end $$;

do $$
declare
  alice uuid := (select id from participants where name = 'Alice');
  bob   uuid := (select id from participants where name = 'Bob');
  carol uuid := (select id from participants where name = 'Carol');
begin
  -- La vue admin_couples montre les deux noms de la paire.
  perform test_assert(
    (select count(*) from admin_couples) = 1
    and (select count(*) from admin_couples
         where (a_name = 'Alice' and b_name = 'Bob')
            or (a_name = 'Bob' and b_name = 'Alice')) = 1,
    'admin_couples lists the pair with both names');

  -- La suppression fonctionne quel que soit l'ordre.
  perform admin_delete_couple(bob, alice);
  perform test_assert((select count(*) from couples) = 0,
    'admin_delete_couple removes the pair (order-insensitive)');

  -- Ré-ajout pour laisser l'état cohérent.
  perform admin_add_couple(alice, carol);
  perform test_assert((select count(*) from admin_couples) = 1,
    'a fresh couple can be added after deletion');
end $$;

begin;
set role anon;
do $$
begin
  begin
    perform count(*) from admin_couples;
    raise exception using errcode = 'TFAIL', message = 'anon must not read admin_couples';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform admin_add_couple('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
    raise exception using errcode = 'TFAIL', message = 'anon must not call admin_add_couple';
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
    perform count(*) from admin_couples;
    raise exception using errcode = 'TFAIL', message = 'authenticated must not read admin_couples';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform admin_delete_couple('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
    raise exception using errcode = 'TFAIL', message = 'authenticated must not call admin_delete_couple';
  exception when insufficient_privilege then
    null;
  end;
end $$;
rollback;

select test_assert(
  (select count(*) from admin_couples) = 1,
  'service role still reads the couples view');