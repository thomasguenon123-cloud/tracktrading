-- ============================================================================
-- RETOUR ARRIERE de 2026-11-11_rapports_lundi.sql
-- ============================================================================
-- Remet les 14 rapports et leurs entrees dans l'etat sauvegarde avant le
-- rattachement (dates, rapports supprimes, textes et biais). Teste le
-- 2026-11-11 (transaction annulee) : 0 ecart avec la sauvegarde.
-- A JOUER UNIQUEMENT juste apres le rattachement : une modification faite depuis
-- dans ces 14 rapports serait perdue. Necessite le schema « sauvegarde ».
-- ============================================================================

do $tt$
declare n int;
begin
  -- Remet les 14 rapports et leurs entrees dans l'etat sauvegarde le 11/11/2026.
  -- A n'utiliser que juste apres le rattachement : une modification faite depuis
  -- dans ces 14 rapports serait perdue.
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'sauvegarde' and table_name = 'rapports_20261111') then
    raise exception 'ARRET : pas de sauvegarde (sauvegarde.rapports_20261111). Rien n''a ete modifie.';
  end if;

  -- 1. Les 5 rapports deplaces reprennent leur date d'origine
  update public.currency_reports r set week_start = s.week_start
  from sauvegarde.rapports_20261111 s
  where s.id = r.id and r.week_start <> s.week_start;

  -- 2. Les 5 anciens rapports supprimes sont recrees (memes identifiants)
  insert into public.currency_reports
  select * from sauvegarde.rapports_20261111 s
  where not exists (select 1 from public.currency_reports r where r.id = s.id);

  -- 3. Les entrees reprennent leur texte, leur biais et leur rapport d'origine ;
  --    celles qui avaient disparu avec leur rapport sont recreees
  update public.currency_report_entries c
  set notes = s.notes, bias = s.bias, report_id = s.report_id
  from sauvegarde.entrees_20261111 s
  where s.id = c.id;
  insert into public.currency_report_entries
  select * from sauvegarde.entrees_20261111 s
  where not exists (select 1 from public.currency_report_entries c where c.id = s.id);

  select count(*) into n from public.currency_reports where extract(isodow from week_start) <> 1;
  raise notice 'Retour arriere fait : % rapport(s) hors lundi (10 attendus).', n;
end $tt$;
