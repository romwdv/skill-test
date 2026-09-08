\set ON_ERROR_STOP on
truncate attributions, couples, participants, forced_attributions;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333');

-- Ajout : un nom, et un lien privé UUID impossible à deviner.
select test_assert(
  (select name = 'Dave' and length(link::text) = 36 from admin_add_participant('Dave')),
  'add: a participant is created with a name and an uuid link');
select test_assert(
  (select count(*) = 4 from participants),
  'add: the participant is persisted');

-- Deux liens ne se ressemblent pas : chacun est unique et imprévisible.
select test_assert(
  (select count(distinct link) = count(*) from participants),
  'links are all distinct');
select test_assert(
  (select count(*) from participants where link::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') = 4,
  'links are version-4 UUIDs');

-- Regénérer un lien : l'ancien ne fonctionne plus (il n'identifie plus la ligne).
do $$
declare
  v_old uuid;
  v_new uuid;
begin
  select link into v_old from participants where name = 'Alice';
  select link into v_new from admin_regenerate_participant_link(
    (select id from participants where name = 'Alice'));
  if v_old = v_new then
    raise exception using errcode = 'TFAIL', message = 'regenerate must yield a new link';
  end if;
  if not exists (select 1 from participants where link = v_new) then
    raise exception using errcode = 'TFAIL', message = 'the new link identifies the participant';
  end if;
  if exists (select 1 from participants where link = v_old) then
    raise exception using errcode = 'TFAIL', message = 'the old link must stop identifying the participant';
  end if;
end $$;

-- Regénérer un lien inconnu : ne renvoie rien (UPDATE sans ligne).
select test_assert(
  (admin_regenerate_participant_link('00000000-0000-4000-8000-000000000000')).id is null,
  'regenerate on unknown id yields nothing');

-- Suppression : la ligne disparaît, ses attributions/couples en cascade.
insert into attributions (giver_id, target_id)
select a.id, c.id from participants a, participants c
where a.name = 'Dave' and c.name = 'Carol';

select test_assert(
  (select count(*) from attributions) = 1,
  'setup: one attribution exists before deletion');

do $$
begin
  perform admin_delete_participant((select id from participants where name = 'Dave'));
  if exists (select 1 from participants where name = 'Dave') then
    raise exception using errcode = 'TFAIL', message = 'delete must remove the participant';
  end if;
  if exists (select 1 from attributions where giver_id in (select id from participants where name = 'Dave')
                                          or target_id in (select id from participants where name = 'Dave')) then
    raise exception using errcode = 'TFAIL', message = 'delete must cascade attributions (Dave)';
  end if;
end $$;

-- Supprimer un repéré comme cible libère le tireur (re-tirable), via la cascade.
insert into attributions (giver_id, target_id)
select a.id, c.id from participants a, participants c
where a.name = 'Bob' and c.name = 'Carol';

do $$
begin
  perform admin_delete_participant((select id from participants where name = 'Bob'));
  if exists (select 1 from attributions where giver_id in (select id from participants where name = 'Bob')
                                          or target_id in (select id from participants where name = 'Bob')) then
    raise exception using errcode = 'TFAIL', message = 'delete must cascade when the giver is removed';
  end if;
end $$;

-- Nom vide : refusé.
do $$
declare
  v_state text;
begin
  begin
    perform admin_add_participant('  ');
    raise exception using errcode = 'TFAIL', message = 'blank name must be rejected';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state is distinct from 'PNAME' then
      raise exception using errcode = 'TFAIL', message = 'blank name must raise PNAME, got: ' || v_state;
    end if;
  end;
end $$;

-- La console admin lit les participants avec leur lien ; RPC réservées à la
-- service role — un participant ne doit pas pouvoir invoquer ces fonctions.
begin;
set role anon;
do $$
begin
  begin
    perform admin_add_participant('Eve');
    raise exception using errcode = 'TFAIL', message = 'anon must not call admin_add_participant';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform count(*) from admin_participants;
    raise exception using errcode = 'TFAIL', message = 'anon must not read admin_participants';
  exception when insufficient_privilege then
    null;
  end;
end $$;
rollback;