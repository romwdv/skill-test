\set ON_ERROR_STOP on
truncate attributions, couples, participants, forced_attributions;
\i :tests/lib/assertions.sql

insert into participants (name, link) values
  ('Alice', '11111111-1111-4111-8111-111111111111'),
  ('Bob',   '22222222-2222-4222-8222-222222222222'),
  ('Carol', '33333333-3333-4333-8333-333333333333');

-- Alice a tiré Bob ; Bob et Carol n'ont pas tiré.
insert into attributions (giver_id, target_id)
select a.id, b.id from participants a, participants b
where a.name = 'Alice' and b.name = 'Bob';

-- Le titulaire voit son nom et sa propre attribution : « tu offres à Bob ».
select test_assert(
  (select name = 'Alice'
      and has_drawn = true
      and target_name = 'Bob'
   from participant_view('11111111-1111-4111-8111-111111111111')),
  'view: giver sees their own name and their own target');

-- La cible ne voit jamais qui la tire : Bob ignore que c'est Alice (surprise
-- préservée) et, n'ayant pas tiré, n'a pas de target_name.
select test_assert(
  (select name = 'Bob'
      and has_drawn = false
      and target_name is null
   from participant_view('22222222-2222-4222-8222-222222222222')),
  'view: a participant who never drew cannot see who targeted them');

-- Lire la vue de quelqu'un d'autre n'expose que SA ligne, jamais les autres.
select test_assert(
  (select count(*) = 1
      and min(name) = 'Carol'
   from participant_view('33333333-3333-4333-8333-333333333333')),
  'view: querying by a link returns exactly that participant');

-- Un lien qui n'existe pas (ou a été régénéré) ne donne rien.
select test_assert(
  ((select count(*) from participant_view('99999999-9999-4999-8999-999999999999')) = 0),
  'view: an unknown link yields no row');

-- Régénérer le lien d'Alice : l'ancien ne marche plus, le nouveau donne accès.
do $$
declare
  v_new uuid;
begin
  select link into v_new from admin_regenerate_participant_link(
    (select id from participants where name = 'Alice'));
  if exists (select 1 from participant_view('11111111-1111-4111-8111-111111111111')) then
    raise exception using errcode = 'TFAIL', message = 'the old link must stop working';
  end if;
  if not exists (
    select 1 from participant_view(v_new)
    where name = 'Alice' and has_drawn = true and target_name = 'Bob'
  ) then
    raise exception using errcode = 'TFAIL', message = 'the new link must identify Alice';
  end if;
end $$;

-- Un participant supprimé : son ancien lien ne donne plus accès.
select test_assert(
  (select name = 'Alice' from participant_view('99999999-9999-4999-8999-999999999999')) is null,
  'a missing participant yields nothing');

-- RPC réservée à la service role : anon ne doit pas pouvoir l'invoquer.
begin;
set role anon;
do $$
begin
  begin
    perform count(*) from participant_view('11111111-1111-4111-8111-111111111111');
    raise exception using errcode = 'TFAIL', message = 'anon must not call participant_view';
  exception when insufficient_privilege then
    null;
  end;
end $$;
rollback;