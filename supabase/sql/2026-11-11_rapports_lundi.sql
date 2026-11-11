-- ============================================================================
-- Rapports dates hors lundi -> rattaches a leur lundi (10 rapports)
-- ============================================================================
-- STATUT : A JOUER par Thomas (editeur SQL Supabase), application fermee.
--   Repetition generale faite le 2026-11-11 sur la base de production, en
--   transaction annulee : toutes les gardes passent ; resultat 0 rapport hors
--   lundi, 24 -> 19 rapports, 8 entrees fusionnees sans perte. Le retour arriere
--   (fichier _retour.sql), teste dans la meme transaction annulee, remet les 14
--   rapports et leurs entrees a l'identique (0 ecart).
--
-- POURQUOI : une ancienne version calculait la date d'une semaine en UTC ; un
--   lundi a minuit (Paris) devenait le dimanche precedent. 9 rapports sont donc
--   dates d'un dimanche (semaine du lundi suivant) et 1 d'un samedi (semaine du
--   lundi precedent, celle qui le contient). Depuis la v=6, une date de semaine est
--   ramenee au lundi : ces rapports ne s'ouvrent plus que par leur date exacte.
--
-- CE QUE FAIT LE BLOC (tout ou rien) :
--   1. Gardes : la base est dans l'etat analyse le 2026-11-11, sinon ARRET.
--   2. Sauvegarde des 14 rapports concernes et de leurs entrees dans le schema
--      « sauvegarde » (non servi par l'API, ferme a anon et authenticated).
--   3. 5 fusions dans le rapport du lundi qui existe deja : texte repris s'il est
--      vide au lundi, sinon ajoute dessous avec la mention « Repris de l'ancien
--      rapport enregistre sous le dimanche JJ/MM » ; biais du lundi garde, celui
--      de l'ancien note s'il differe. Controle que tout est retrouve, PUIS
--      suppression des 5 anciens rapports.
--   4. 5 deplacements simples : dimanche -> lundi suivant.
--   5. Controle final : 0 rapport hors lundi, 5 rapports de moins.
--   Aucune capture n'est concernee (verifie).
--
-- RETOUR ARRIERE : 2026-11-11_rapports_lundi_retour.sql (juste apres seulement).
-- MENAGE (quelques jours plus tard, une fois verifie dans l'app) :
--   drop schema sauvegarde cascade;
-- ============================================================================

do $tt$
declare
  n int;
  n_rapports_avant int;
  manque text;
begin
  -- ------------------------------------------------------------------------
  -- 1. GARDES : la base est exactement dans l'etat analyse le 11/11/2026,
  --    sinon ARRET (rien n'est modifie).
  -- ------------------------------------------------------------------------
  select count(*) into n from public.currency_reports where extract(isodow from week_start) <> 1;
  if n <> 10 then
    raise exception 'ARRET : % rapport(s) hors lundi au lieu de 10. Rien n''a ete modifie.', n;
  end if;

  select count(*) into n from public.currency_reports r
  join (values
    ('528ff87f-e398-41f3-bc49-e1043d87116a'::uuid, date '2026-01-04'),
    ('7d2d7b49-5d21-41a7-b05d-3b1a6e20fd53'::uuid, date '2026-03-22'),
    ('0bb1b42d-e9c2-4743-8f67-5864250daf0d'::uuid, date '2026-03-29'),
    ('ad5de53a-87a6-4694-adf1-374b498ad7fe'::uuid, date '2026-04-19'),
    ('9999e360-cc71-4045-b687-4f48d42f763e'::uuid, date '2026-04-25'),
    ('9feafe57-32aa-4494-8d5b-b0c0f8d120b7'::uuid, date '2026-04-26'),
    ('b1e8fc28-7f39-4c4e-aaa6-5cac09c2d9fa'::uuid, date '2026-05-03'),
    ('3d7915e8-b93d-42b2-a032-938b377d2602'::uuid, date '2026-05-17'),
    ('69bf9a06-021a-430c-a348-b0ee53511d34'::uuid, date '2026-05-24'),
    ('7a565acb-6775-498c-af53-227aa99813f7'::uuid, date '2026-05-24'),
    ('ba607598-02d5-4ed4-91aa-432a3f4eddfa'::uuid, date '2026-04-20'),
    ('7dd2c6f7-8ccb-4e83-b771-c177da61e279'::uuid, date '2026-04-27'),
    ('2ed513c5-dd12-4ab4-b247-cdfc50e98176'::uuid, date '2026-05-18'),
    ('229acc89-92f0-4deb-a731-60e9f338bf0c'::uuid, date '2026-05-25')
  ) v(id, d) on r.id = v.id and r.week_start = v.d;
  if n <> 14 then
    raise exception 'ARRET : % rapport(s) sur 14 a la date attendue. Rien n''a ete modifie.', n;
  end if;

  select count(*) into n from public.currency_report_images i
  join public.currency_report_entries e on e.id = i.entry_id
  where e.report_id in (
    '528ff87f-e398-41f3-bc49-e1043d87116a','7d2d7b49-5d21-41a7-b05d-3b1a6e20fd53',
    '0bb1b42d-e9c2-4743-8f67-5864250daf0d','ad5de53a-87a6-4694-adf1-374b498ad7fe',
    '9999e360-cc71-4045-b687-4f48d42f763e','9feafe57-32aa-4494-8d5b-b0c0f8d120b7',
    'b1e8fc28-7f39-4c4e-aaa6-5cac09c2d9fa','3d7915e8-b93d-42b2-a032-938b377d2602',
    '69bf9a06-021a-430c-a348-b0ee53511d34','7a565acb-6775-498c-af53-227aa99813f7');
  if n <> 0 then
    raise exception 'ARRET : % capture(s) sur les anciens rapports (non prevu). Rien n''a ete modifie.', n;
  end if;

  select count(*) into n_rapports_avant from public.currency_reports;

  -- ------------------------------------------------------------------------
  -- 2. SAUVEGARDE des 14 rapports et de leurs entrees, dans un schema que
  --    l'API ne sert pas (et ferme a anon / authenticated par precaution).
  --    Si ces tables existent deja (bloc deja joue ?), ARRET.
  -- ------------------------------------------------------------------------
  create schema if not exists sauvegarde;
  revoke all on schema sauvegarde from public, anon, authenticated;
  create table sauvegarde.rapports_20261111 as
    select * from public.currency_reports where id in (
      '528ff87f-e398-41f3-bc49-e1043d87116a','7d2d7b49-5d21-41a7-b05d-3b1a6e20fd53',
      '0bb1b42d-e9c2-4743-8f67-5864250daf0d','ad5de53a-87a6-4694-adf1-374b498ad7fe',
      '9999e360-cc71-4045-b687-4f48d42f763e','9feafe57-32aa-4494-8d5b-b0c0f8d120b7',
      'b1e8fc28-7f39-4c4e-aaa6-5cac09c2d9fa','3d7915e8-b93d-42b2-a032-938b377d2602',
      '69bf9a06-021a-430c-a348-b0ee53511d34','7a565acb-6775-498c-af53-227aa99813f7',
      'ba607598-02d5-4ed4-91aa-432a3f4eddfa','7dd2c6f7-8ccb-4e83-b771-c177da61e279',
      '2ed513c5-dd12-4ab4-b247-cdfc50e98176','229acc89-92f0-4deb-a731-60e9f338bf0c');
  create table sauvegarde.entrees_20261111 as
    select * from public.currency_report_entries where report_id in (
      select id from sauvegarde.rapports_20261111);
  revoke all on sauvegarde.rapports_20261111, sauvegarde.entrees_20261111 from public, anon, authenticated;

  -- ------------------------------------------------------------------------
  -- 3. FUSIONS : ancien rapport -> rapport du lundi qui existe deja.
  --    Pour chaque devise remplie de l'ancien :
  --    - texte : repris tel quel si celui du lundi est vide, sinon AJOUTE
  --      dessous, precede de « Repris de l'ancien rapport enregistre sous le
  --      dimanche JJ/MM » ;
  --    - biais : celui du lundi est garde ; s'il est vide, celui de l'ancien
  --      le remplace ; s'ils different, le biais de l'ancien est note.
  -- ------------------------------------------------------------------------
  create temporary table tt_fusions (ancien uuid, lundi uuid) on commit drop;
  insert into tt_fusions values
    ('ad5de53a-87a6-4694-adf1-374b498ad7fe', 'ba607598-02d5-4ed4-91aa-432a3f4eddfa'), -- dim. 19/04 (vide) -> lun. 20/04
    ('9999e360-cc71-4045-b687-4f48d42f763e', 'ba607598-02d5-4ed4-91aa-432a3f4eddfa'), -- sam. 25/04 -> lun. 20/04 (meme semaine)
    ('9feafe57-32aa-4494-8d5b-b0c0f8d120b7', '7dd2c6f7-8ccb-4e83-b771-c177da61e279'), -- dim. 26/04 -> lun. 27/04
    ('3d7915e8-b93d-42b2-a032-938b377d2602', '2ed513c5-dd12-4ab4-b247-cdfc50e98176'), -- dim. 17/05 -> lun. 18/05
    ('7a565acb-6775-498c-af53-227aa99813f7', '229acc89-92f0-4deb-a731-60e9f338bf0c'); -- dim. 24/05 -> lun. 25/05

  -- 3a. Devise presente des deux cotes : fusion dans l'entree du lundi
  update public.currency_report_entries c set
    notes = (case
        when coalesce(c.notes, '') = '' then o.notes
        when coalesce(o.notes, '') = '' then c.notes
        else c.notes || '<div><br></div><div><b>— Repris de l''ancien rapport enregistré sous le '
             || (case extract(isodow from ro.week_start)::int when 7 then 'dimanche ' when 6 then 'samedi ' else '' end)
             || to_char(ro.week_start, 'DD/MM') || ' —</b></div>' || o.notes
      end)
      || (case when o.bias is not null and c.bias is not null and o.bias <> c.bias
          then '<div><b>(Biais noté dans l''ancien rapport du ' || to_char(ro.week_start, 'DD/MM') || ' : '
               || (case o.bias when 'bullish' then 'Haussier' when 'sl_bullish' then 'Légèrement haussier'
                    when 'neutral' then 'Neutre' when 'sl_bearish' then 'Légèrement baissier'
                    when 'bearish' then 'Baissier' else o.bias end) || ')</b></div>'
          else '' end),
    bias = coalesce(c.bias, o.bias)
  from public.currency_report_entries o
  join tt_fusions f on f.ancien = o.report_id
  join public.currency_reports ro on ro.id = o.report_id
  where c.report_id = f.lundi and c.currency = o.currency
    and (coalesce(o.notes, '') <> '' or o.bias is not null);

  -- 3b. Devise absente du lundi : l'entree de l'ancien rapport y est rattachee
  update public.currency_report_entries o set report_id = f.lundi
  from tt_fusions f
  where o.report_id = f.ancien
    and (coalesce(o.notes, '') <> '' or o.bias is not null)
    and not exists (select 1 from public.currency_report_entries c
                    where c.report_id = f.lundi and c.currency = o.currency);

  -- 3c. CONTROLE avant toute suppression : chaque texte et chaque biais de
  --     l'ancien rapport (sauvegarde) se retrouve dans le rapport du lundi.
  select string_agg(left(s.report_id::text, 8) || '/' || s.currency, ', ') into manque
  from sauvegarde.entrees_20261111 s
  join tt_fusions f on f.ancien = s.report_id
  where (coalesce(s.notes, '') <> '' or s.bias is not null)
    and not exists (
      select 1 from public.currency_report_entries c
      where c.report_id = f.lundi and c.currency = s.currency
        and (coalesce(s.notes, '') = '' or strpos(coalesce(c.notes, ''), s.notes) > 0)
        and (s.bias is null or c.bias is not null)
        and (s.bias is null or c.bias = s.bias or strpos(coalesce(c.notes, ''), '(Biais noté dans l''ancien rapport') > 0));
  if manque is not null then
    raise exception 'ARRET : contenu non retrouve dans le rapport du lundi (%). Rien n''a ete modifie.', manque;
  end if;

  -- 3d. Les 5 anciens rapports fusionnes sont supprimes (leurs entrees, deja
  --     reprises ou vides, partent avec eux).
  delete from public.currency_reports where id in (select ancien from tt_fusions);
  get diagnostics n = row_count;
  if n <> 5 then
    raise exception 'ARRET : % ancien(s) rapport(s) supprime(s) au lieu de 5. Rien n''a ete modifie.', n;
  end if;

  -- ------------------------------------------------------------------------
  -- 4. DEPLACEMENTS : dimanche -> lundi suivant, quand aucun rapport n'existe
  --    deja ce lundi-la dans le meme espace.
  -- ------------------------------------------------------------------------
  update public.currency_reports set week_start = week_start + 1
  where id in ('528ff87f-e398-41f3-bc49-e1043d87116a', -- 04/01 -> 05/01
               '7d2d7b49-5d21-41a7-b05d-3b1a6e20fd53', -- 22/03 -> 23/03
               '0bb1b42d-e9c2-4743-8f67-5864250daf0d', -- 29/03 -> 30/03
               'b1e8fc28-7f39-4c4e-aaa6-5cac09c2d9fa', -- 03/05 -> 04/05
               '69bf9a06-021a-430c-a348-b0ee53511d34') -- 24/05 -> 25/05 (autre espace)
    and extract(isodow from week_start) = 7;
  get diagnostics n = row_count;
  if n <> 5 then
    raise exception 'ARRET : % rapport(s) deplace(s) au lieu de 5. Rien n''a ete modifie.', n;
  end if;

  -- ------------------------------------------------------------------------
  -- 5. CONTROLE FINAL
  -- ------------------------------------------------------------------------
  select count(*) into n from public.currency_reports where extract(isodow from week_start) <> 1;
  if n <> 0 then
    raise exception 'ARRET : il reste % rapport(s) hors lundi. Rien n''a ete modifie.', n;
  end if;
  select count(*) into n from public.currency_reports;
  if n <> n_rapports_avant - 5 then
    raise exception 'ARRET : % rapports au lieu de %. Rien n''a ete modifie.', n, n_rapports_avant - 5;
  end if;

  raise notice 'OK : 5 rapports deplaces au lundi, 5 fusionnes puis supprimes, 0 rapport hors lundi. Sauvegarde : schema sauvegarde.';
end $tt$;
