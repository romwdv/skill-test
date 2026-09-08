\set ON_ERROR_STOP on
truncate attributions, couples, participants, forced_attributions;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333'),
  ('Dave',  '44444444-4444-4444-8444-444444444444'),
  ('Eve',   '55555555-5555-4555-8555-555555555555');

-- Deux couples disjoints : Alice<->Bob et Carol<->Dave.
insert into couples (participant_a_id, participant_b_id)
select a.id, b.id from participants a, participants b
where a.name = 'Alice' and b.name = 'Bob';

insert into couples (participant_a_id, participant_b_id)
select a.id, b.id from participants a, participants b
where a.name = 'Carol' and b.name = 'Dave';

-- Forcer : Alice offre à Bob malgré leur couple.
select test_assert(
  (select giver_id = (select id from participants where name = 'Alice')
      and target_id = (select id from participants where name = 'Bob')
     from admin_force_attribution(
       (select id from participants where name = 'Alice'),
       (select id from participants where name = 'Bob'))),
  'forced draw creates the attribution');

select test_assert(
  (select forced from admin_attributions where giver = 'Alice' and target = 'Bob'),
  'admin view identifies the forced attribution');

select test_assert(
  (select count(*) from forced_attributions) = 1,
  'the force is recorded in forced_attributions');

-- Le participant ne voit jamais le forçage : aucun GRANT sur la table.
select test_assert(
  (select count(*) from information_schema.role_table_grants
    where table_name = 'forced_attributions'
      and grantee in ('anon', 'authenticated')) = 0,
  'no participant role can read forced_attributions');

-- Forcage d'un non-couple : refusé.
do $$
declare v_state text;
begin
  begin
    perform admin_force_attribution(
      (select id from participants where name = 'Alice'),
      (select id from participants where name = 'Carol'));
    raise exception using errcode = 'TFAIL', message = 'non-couple force must be rejected';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state is distinct from 'PFORC' then
      raise exception using errcode = 'TFAIL', message = 'expected PFORC, got ' || v_state;
    end if;
  end;
end $$;

-- Tireur déjà tiré : refusé (Alice a déjà tiré sur Bob ; la vérif PDRAW passe
-- avant PTAKEN).
do $$
declare v_state text;
begin
  begin
    perform admin_force_attribution(
      (select id from participants where name = 'Alice'),
      (select id from participants where name = 'Bob'));
    raise exception using errcode = 'TFAIL', message = 'already-drawn giver must be rejected';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state is distinct from 'PDRAW' then
      raise exception using errcode = 'TFAIL', message = 'expected PDRAW, got ' || v_state;
    end if;
  end;
end $$;

-- Cible déjà cible : Bob l'est. Carol->Dave est un couple, mais avec Eve->Dave
-- insérée en direct (tirage normal), Dave est déjà cible.
insert into attributions (giver_id, target_id)
select e.id, d.id from participants e, participants d
where e.name = 'Eve' and d.name = 'Dave';

do $$
declare v_state text;
begin
  begin
    perform admin_force_attribution(
      (select id from participants where name = 'Carol'),
      (select id from participants where name = 'Dave'));
    raise exception using errcode = 'TFAIL', message = 'taken target must be rejected';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state is distinct from 'PTAKN' then
      raise exception using errcode = 'TFAIL', message = 'expected PTAKN, got ' || v_state;
    end if;
  end;
end $$;

-- Auto-attribution : refusé (vérif délibérée au-dessus de la contrainte).
do $$
declare v_state text;
begin
  begin
    perform admin_force_attribution(
      (select id from participants where name = 'Eve'),
      (select id from participants where name = 'Eve'));
    raise exception using errcode = 'TFAIL', message = 'self draw must be rejected';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state is distinct from 'PSELF' then
      raise exception using errcode = 'TFAIL', message = 'expected PSELF, got ' || v_state;
    end if;
  end;
end $$;

-- Participant inconnu : refusé.
do $$
declare v_state text;
begin
  begin
    perform admin_force_attribution(
      '00000000-0000-4000-8000-000000000000',
      (select id from participants where name = 'Bob'));
    raise exception using errcode = 'TFAIL', message = 'unknown giver must be rejected';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state is distinct from 'PUNKN' then
      raise exception using errcode = 'TFAIL', message = 'expected PUNKN, got ' || v_state;
    end if;
  end;
end $$;

-- Réservé à la service role.
begin;
set role anon;
do $$
begin
  begin
    perform admin_force_attribution(
      (select id from participants where name = 'Alice'),
      (select id from participants where name = 'Bob'));
    raise exception using errcode = 'TFAIL', message = 'anon must not force a draw';
  exception when insufficient_privilege then
    null;
  end;
end $$;
rollback;