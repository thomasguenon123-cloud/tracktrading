'use strict';
// v=6 — Rapports « données honnêtes » : une saisie n'est jamais perdue en
// silence et un échec ne se présente jamais comme un succès (auto-save,
// changement de semaine, lecture du rapport, captures, semaine du lundi).
// Chaque garde APPELLE le code (chargement, auto-save, changement de semaine,
// dépôt de capture…) et porte un témoin positif.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, lire, injecter, faireDb, horsContexte, RACINE, SOURCE_APP, sansCommentaires } = require('./charger-app.js');

const tour = () => new Promise((r) => setImmediate(r));
async function laisserFiler(n = 12) { for (let i = 0; i < n; i++) await tour(); }

const LUNDI = '2026-10-19T10:00:00+02:00'; // lundi 19/10/2026, 10 h à Paris

// Base de rapports fictive : un rapport par semaine (clé = week_start), des
// entrées par devise, des captures par entrée. `panne['table:op']` (booléen ou
// fonction de l'état de la requête) fait échouer l'opération ; `guichet` garde
// chaque réponse en vol jusqu'à ce que le test la serve (db.enAttente).
function baseRapports({ semaines, panne = {}, guichet = false } = {}) {
  const donnees = semaines || {
    '2026-10-19': { id: 'r1', ws: 'ws-a', entrees: [{ id: 'e1', currency: 'USD', bias: 'bullish', notes: 'note en base', images: [] }] },
  };
  const lectures = [];
  const enAttente = [];
  const f = (etat, c) => (etat.filtres.find((x) => x[1] === c) || [])[2];
  const refus = (nom, etat) => {
    const p = panne[nom + ':' + etat.op];
    return typeof p === 'function' ? p(etat) : !!p;
  };
  const rapports = () => Object.entries(donnees).map(([w, r]) => ({ week_start: r.semaine || w, ...r }));
  function repondre(nom, etat) {
    if (refus(nom, etat)) return { data: null, error: { message: 'refus' } };
    if (etat.op === 'select') lectures.push([nom, horsContexte(etat.filtres)]);
    if (nom === 'currency_reports') {
      if (etat.op === 'insert') return { data: { id: 'r-neuf' }, error: null };
      if (etat.op !== 'select') return { data: null, error: null };
      const r = rapports().find((x) => x.week_start === f(etat, 'week_start') && (!f(etat, 'workspace_id') || x.ws === f(etat, 'workspace_id')));
      if (!r) return { data: null, error: null };
      return { data: { id: r.id, week_start: r.week_start, currency_report_entries: r.entrees.map((e) => ({ ...e, currency_report_images: e.images || [] })) }, error: null };
    }
    if (nom === 'currency_report_entries') {
      if (etat.op === 'insert') return { data: { id: 'e-neuf' }, error: null };
      if (etat.op !== 'select') return { data: null, error: null };
      const r = rapports().find((x) => x.id === f(etat, 'report_id'));
      const e = r && r.entrees.find((x) => x.currency === f(etat, 'currency'));
      return { data: e ? { id: e.id, bias: e.bias, notes: e.notes } : null, error: null };
    }
    if (nom === 'currency_report_images') {
      if (etat.op !== 'select') return { data: null, error: null };
      const e = rapports().flatMap((r) => r.entrees).find((x) => x.id === f(etat, 'entry_id'));
      return { data: ((e && e.images) || []).filter((i) => i.image_type === f(etat, 'image_type')), error: null };
    }
    return { data: [], error: null };
  }
  let db = null;
  const reponses = new Proxy({}, {
    get: (_, nom) => (etat) => {
      if (!db.guichet) return repondre(String(nom), etat);
      return new Promise((ok) => enAttente.push({ nom: String(nom), etat, servir: () => ok(repondre(String(nom), etat)) }));
    },
  });
  db = faireDb({ reponses });
  return Object.assign(db, { lectures, enAttente, donnees, panne, guichet });
}
// Sert les requêtes en vol une par une (la plus ancienne d'abord, ou la plus
// récente avec dernierDabord), jusqu'à ce qu'il n'y en ait plus.
async function servirTout(db, { dernierDabord = false } = {}) {
  await laisserFiler();
  while (db.enAttente.length) { (dernierDabord ? db.enAttente.pop() : db.enAttente.shift()).servir(); await laisserFiler(); }
}
// Ouvre l'onglet Rapports sur la semaine donnée (lundi 19/10 par défaut).
async function ouvrirRapports(db, { maintenant, semaine = '2026-10-19', ...opts } = {}) {
  const ctx = charger({ maintenant: maintenant || new Date(LUNDI), db, muet: true, ...opts });
  const S = lire(ctx, 'S');
  S.workspaceId = 'ws-a'; S.currentWorkspaceId = 'ws-a';
  ctx.__el('rpt-week').value = semaine;
  await ctx.loadCurrencyReport();
  return ctx;
}
// Lecture de fichier immédiate (le FileReader du harnais ne rappelle jamais).
class LecteurImmediat { readAsDataURL(f) { setImmediate(() => this.onload({ target: { result: 'data:image/png;base64,' + (f.name || 'X') } })); } }
const ecritures = (db, table, op) => db.appels.filter((a) => a.table === table && (!op || a.op === op));
const notesEcrites = (db) => ecritures(db, 'currency_report_entries').map((a) => a.charge.notes);
const indicateur = (ctx) => ctx.__el('autosave-indicator');

// ─── Constat 48 : « ✓ Sauvegardé » seulement si c'est écrit ───────────────────
test('auto-save : un enregistrement refusé affiche « ✗ Non enregistré » durable, jamais « ✓ Sauvegardé »', async () => {
  // Témoin : écriture acceptée → « ✓ Sauvegardé » et l'UPDATE est parti
  const dbOk = baseRapports();
  const ok = await ouvrirRapports(dbOk);
  ok._curNotesCache.USD = 'note tapée';
  await ok.saveCurrencyReportAuto();
  assert.equal(indicateur(ok).textContent, '✓ Sauvegardé');
  assert.equal(indicateur(ok).className, 'saved');
  assert.deepEqual(notesEcrites(dbOk), ['note tapée']);
  // Refus de la base (RLS, réseau) : échec affiché, en rouge, sans masquage à 3 s
  const dbKo = baseRapports({ panne: { 'currency_report_entries:update': true } });
  const ko = await ouvrirRapports(dbKo, { minuteriesImmediates: true });
  ko._curNotesCache.USD = 'note tapée';
  await ko.saveCurrencyReportAuto();
  await laisserFiler();
  const ind = indicateur(ko);
  assert.equal(ind.textContent, '✗ Non enregistré — réessayer');
  assert.equal(ind.className, 'error', 'reste affiché jusqu au prochain succès');
  assert.equal(ecritures(dbKo, 'currency_report_entries', 'update').length, 1, 'témoin : l écriture a bien été tentée');
  // Réessayer : un clic sur l'indicateur, une fois la base revenue
  dbKo.panne['currency_report_entries:update'] = false;
  await ind.onclick();
  assert.equal(ind.textContent, '✓ Sauvegardé');
  assert.deepEqual(notesEcrites(dbKo), ['note tapée', 'note tapée']);
});

test('auto-save : une entrée illisible n est pas prise pour une entrée absente (pas d INSERT en double)', async () => {
  const db = baseRapports({ panne: { 'currency_report_entries:select': true } });
  const ctx = await ouvrirRapports(db);
  ctx._curNotesCache.USD = 'note tapée';
  await ctx.saveCurrencyReportAuto();
  assert.equal(indicateur(ctx).textContent, '✗ Non enregistré — réessayer');
  assert.equal(ecritures(db, 'currency_report_entries').length, 0, 'aucune écriture à l aveugle');
  // Témoin : lecture possible → UPDATE de l'entrée existante
  db.panne['currency_report_entries:select'] = false;
  await ctx.saveCurrencyReportAuto();
  assert.deepEqual(ecritures(db, 'currency_report_entries').map((a) => a.op), ['update']);
});

test('styles : l état d échec de l indicateur est visible et cliquable', () => {
  const css = fs.readFileSync(path.join(RACINE, 'styles.css'), 'utf8');
  const regle = (sel) => (new RegExp(sel.replace(/[.#]/g, '\\$&') + '\\{([^}]*)\\}').exec(css) || [])[1] || '';
  assert.match(regle('#autosave-indicator'), /opacity:0/, 'témoin : masqué par défaut');
  const erreur = regle('#autosave-indicator.error');
  assert.match(erreur, /opacity:1/);
  assert.match(erreur, /pointer-events:auto/);
  assert.match(erreur, /var\(--red\)/);
});

// ─── Constat 59 : la fin d'un enregistrement ancien ne dit pas « ✓ » ─────────
test('auto-save : la fin d un enregistrement ancien ne dit pas « ✓ Sauvegardé » quand une frappe plus récente attend', async () => {
  const db = baseRapports();
  const ctx = await ouvrirRapports(db);
  db.guichet = true;
  ctx._curNotesCache.USD = 'ab';
  ctx.scheduleAutoSave();
  const a = ctx.saveCurrencyReportAuto(); // la minuterie de 1 s se déclenche
  await laisserFiler();
  ctx._curNotesCache.USD = 'abc'; // frappe suivante : sa minuterie attend
  ctx.scheduleAutoSave();
  await servirTout(db); await a;
  assert.equal(indicateur(ctx).textContent, '● En cours…', '« abc » n est pas encore parti');
  // Témoin : la minuterie de « abc » se déclenche → seule elle dit « ✓ »
  const b = ctx.saveCurrencyReportAuto();
  await servirTout(db); await b;
  assert.equal(indicateur(ctx).textContent, '✓ Sauvegardé');
  assert.deepEqual(notesEcrites(db), ['ab', 'abc']);
});

test('auto-save : deux enregistrements ne partent pas en même temps (le plus récent écrit en dernier)', async () => {
  const db = baseRapports();
  const ctx = await ouvrirRapports(db);
  db.guichet = true;
  ctx._curNotesCache.USD = 'ab';
  const a = ctx.saveCurrencyReportAuto();
  await laisserFiler();
  assert.equal(db.enAttente.length, 1, 'témoin : le premier enregistrement est en vol');
  ctx._curNotesCache.USD = 'abc';
  const b = ctx.saveCurrencyReportAuto();
  await laisserFiler();
  assert.equal(db.enAttente.length, 1, 'le second attend la fin du premier');
  // Même si la base répond d'abord à la requête la plus récente, l'ordre tient
  await servirTout(db, { dernierDabord: true }); await Promise.all([a, b]);
  assert.deepEqual(notesEcrites(db), ['ab', 'abc']);
  assert.equal(indicateur(ctx).textContent, '✓ Sauvegardé');
});

// ─── Constat 49 : changer de semaine, de mois, rouvrir : rien ne se perd ─────
const DEUX_SEMAINES = () => ({
  '2026-10-19': { id: 'r1', ws: 'ws-a', entrees: [{ id: 'e1', currency: 'USD', bias: 'bullish', notes: 'note en base', images: [] }] },
  '2026-10-26': { id: 'r2', ws: 'ws-a', entrees: [{ id: 'e2', currency: 'USD', bias: 'bearish', notes: 'semaine suivante', images: [] }] },
});
const semainesLues = (db) => db.lectures.filter(([t]) => t === 'currency_reports').map(([, f]) => (f.find((x) => x[1] === 'week_start') || [])[2]);

test('changer de semaine après un échec d enregistrement : on reste, la saisie est gardée, on demande avant d abandonner', async () => {
  // Témoin : écriture acceptée → la note part AVANT la bascule, puis l'autre semaine se charge
  const dbOk = baseRapports({ semaines: DEUX_SEMAINES() });
  const ok = await ouvrirRapports(dbOk);
  ok._curNotesCache.USD = 'saisie du 19';
  await ok.selectWeek('2026-10-26', null);
  assert.deepEqual(notesEcrites(dbOk), ['saisie du 19']);
  assert.equal(lire(ok, 'S')._rptSemaine, '2026-10-26');
  assert.equal(ok._curNotesCache.USD, 'semaine suivante');
  // Échec : pas de bascule, la saisie reste, l'indicateur le dit, on demande
  const db = baseRapports({ semaines: DEUX_SEMAINES(), panne: { 'currency_report_entries:update': true } });
  const ctx = await ouvrirRapports(db);
  ctx._curNotesCache.USD = 'saisie du 19';
  await ctx.selectWeek('2026-10-26', null);
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-10-19');
  assert.equal(ctx.__el('rpt-week').value, '2026-10-19');
  assert.equal(ctx._curNotesCache.USD, 'saisie du 19');
  assert.deepEqual(semainesLues(db), ['2026-10-19'], 'l autre semaine n a pas été chargée');
  assert.equal(indicateur(ctx).textContent, '✗ Non enregistré — réessayer');
  assert.match(ctx.__el('confirm-msg').textContent, /n'est pas en base/);
  // « Abandonner ma saisie » : la bascule a lieu, sans nouvelle écriture
  ctx.execConfirm();
  await laisserFiler();
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-10-26');
  assert.equal(ecritures(db, 'currency_report_entries', 'update').length, 1);
  assert.notEqual(indicateur(ctx).className, 'error', 'l échec abandonné ne reste pas affiché sur l autre semaine');
});

test('tout effacer puis changer de semaine écrit l effacement ; une simple visite n écrit rien', async () => {
  const db = baseRapports({ semaines: DEUX_SEMAINES() });
  const ctx = await ouvrirRapports(db);
  // Un collègue a écrit EUR depuis le chargement (entrée inconnue de cet écran)
  db.donnees['2026-10-19'].entrees.push({ id: 'e9', currency: 'EUR', bias: 'bearish', notes: 'analyse d un collègue', images: [] });
  ctx._curBiasCache.USD = ''; ctx._curNotesCache.USD = ''; // biais et note effacés
  ctx._curBiasCache.EUR = ''; ctx._curNotesCache.EUR = ''; // EUR visitée, rien tapé
  await ctx.selectWeek('2026-10-26', null);
  assert.deepEqual(ecritures(db, 'currency_report_entries').map((a) => [a.op, a.charge.bias, a.charge.notes]), [['update', null, null]]);
  // Témoin négatif : une visite seule d'une semaine sans rapport ne crée pas de rapport vide
  const db2 = baseRapports({ semaines: {} });
  const c2 = await ouvrirRapports(db2);
  c2._curBiasCache.USD = ''; c2._curNotesCache.USD = '';
  await c2.selectWeek('2026-10-26', null);
  assert.equal(db2.appels.length, 0);
});

test('date de semaine changée : la saisie part dans la semaine AFFICHÉE, pas dans celle que le champ porte déjà', async () => {
  const db = baseRapports({ semaines: {} }); // pas encore de rapport cette semaine
  const ctx = await ouvrirRapports(db);
  ctx._curNotesCache.USD = 'tapé pour le 19/10';
  ctx.__el('rpt-week').value = '2026-10-26'; // le navigateur a déjà changé le champ
  await ctx.onWeekDateChange();
  assert.deepEqual(ecritures(db, 'currency_reports', 'insert').map((a) => a.charge.week_start), ['2026-10-19']);
  assert.deepEqual(notesEcrites(db), ['tapé pour le 19/10']);
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-10-26', 'témoin : puis la semaine choisie se charge');
  // Échec : le champ reprend la semaine affichée, la saisie reste
  const db2 = baseRapports({ semaines: {}, panne: { 'currency_reports:insert': true } });
  const c2 = await ouvrirRapports(db2);
  c2._curNotesCache.USD = 'tapé pour le 19/10';
  c2.__el('rpt-week').value = '2026-10-26';
  await c2.onWeekDateChange();
  assert.equal(c2.__el('rpt-week').value, '2026-10-19');
  assert.equal(lire(c2, 'S')._rptSemaine, '2026-10-19');
  assert.equal(c2._curNotesCache.USD, 'tapé pour le 19/10');
});

test('changer de mois après un échec : la liste reprend le mois affiché, rien n est rechargé', async () => {
  const db = baseRapports({ panne: { 'currency_report_entries:update': true } });
  const ctx = await ouvrirRapports(db);
  injecter(ctx, { S_rptMonth: '2026-10' });
  ctx._curNotesCache.USD = 'saisie';
  ctx.__el('rpt-month-pick').value = '2026-09'; // la liste porte déjà le mois choisi
  await ctx.switchRptMonth('2026-09', null);
  assert.equal(lire(ctx, 'S_rptMonth'), '2026-10');
  assert.equal(ctx.__el('rpt-month-pick').value, '2026-10');
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-10-19');
  assert.deepEqual(semainesLues(db), ['2026-10-19']);
  // Témoin : base revenue → la saisie part, puis septembre s'ouvre
  db.panne['currency_report_entries:update'] = false;
  await ctx.switchRptMonth('2026-09', null);
  assert.equal(lire(ctx, 'S_rptMonth'), '2026-09');
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-09-28');
  assert.deepEqual(notesEcrites(db), ['saisie', 'saisie']);
});

test('rouvrir l onglet Rapports après un échec ne recharge pas par-dessus la saisie', async () => {
  const db = baseRapports({ panne: { 'currency_report_entries:update': true } });
  const ctx = await ouvrirRapports(db);
  ctx._curNotesCache.USD = 'saisie';
  await ctx.loadCurrencyReport(); // clic sur l'onglet Rapports
  assert.equal(ctx._curNotesCache.USD, 'saisie');
  assert.deepEqual(semainesLues(db), ['2026-10-19'], 'pas de rechargement');
  assert.match(ctx.__el('toast').textContent, /non enregistrée/);
  // Témoin : base revenue → la saisie est écrite, puis le rapport se recharge
  db.panne['currency_report_entries:update'] = false;
  await ctx.loadCurrencyReport();
  assert.deepEqual(notesEcrites(db), ['saisie', 'saisie']);
  assert.deepEqual(semainesLues(db), ['2026-10-19', '2026-10-19']);
});

// ─── Constat 50 : une lecture ratée n'est pas une semaine vide ───────────────
test('lecture du rapport en échec : message et Réessayer, aucun formulaire, aucune écriture', async () => {
  const db = baseRapports({ semaines: DEUX_SEMAINES() });
  const ctx = await ouvrirRapports(db);
  ctx.FileReader = LecteurImmediat;
  assert.equal(lire(ctx, 'S')._currentRptId, 'r1', 'témoin : semaine du 19 chargée');
  db.panne['currency_reports:select'] = true; // réseau instable
  await ctx.selectWeek('2026-10-26', null);
  const vue = () => ctx.__el('cur-single-view').innerHTML;
  assert.match(vue(), /Impossible de charger le rapport de la semaine du 26\/10/);
  assert.match(vue(), /Réessayer/);
  assert.ok(!vue().includes('id="cnotes-USD"'), 'pas de formulaire vide et éditable');
  assert.equal(lire(ctx, 'S')._currentRptId, null, 'jamais l id de la semaine précédente');
  // Les boutons de devise et le BILAN n'ouvrent pas un formulaire vide non plus
  injecter(ctx, { S_curCode: 'EUR' }); ctx.renderCurrencyView();
  assert.match(vue(), /Impossible de charger/);
  ctx.renderBilanView();
  assert.match(vue(), /Impossible de charger/);
  // La base revient, mais la semaine n'a pas été relue : rien ne part
  db.panne['currency_reports:select'] = false;
  ctx._curBiasCache.EUR = ''; ctx._curNotesCache.EUR = '';
  ctx._curNotesCache.USD = 'nouvelle idée';
  await ctx.saveCurrencyReportAuto();
  await ctx.setCurImg('USD', 'pm', { name: 'capture.png', size: 10 });
  await laisserFiler();
  assert.match(ctx.__el('toast').textContent, /non chargé : capture non enregistrée/);
  ctx.actionUtilisateur(); // le clic sur « Supprimer »
  await ctx.clearCurImg('USD', 'pm');
  assert.match(ctx.__el('toast').textContent, /non chargé : rien n'est supprimé/);
  assert.deepEqual(db.appels, [], 'aucune écriture sur un rapport non lu');
  assert.notEqual(indicateur(ctx).textContent, '✓ Sauvegardé');
  // Témoin : « Réessayer » relit la semaine et affiche le rapport existant
  injecter(ctx, { S_curCode: 'USD' });
  await ctx.chargerRapport();
  assert.match(vue(), /id="cnotes-USD"/);
  assert.match(vue(), /semaine suivante/);
  assert.match(vue(), /value="bearish" selected/);
  assert.equal(lire(ctx, 'S')._currentRptId, 'r2');
});

// ─── Constat 51 : changer de semaine pendant un envoi ne mélange pas les semaines
// Sert la requête en vol qui répond à `choix` (elle doit exister).
function servir(db, choix) {
  const i = db.enAttente.findIndex(choix);
  assert.ok(i >= 0, 'requête attendue en vol');
  db.enAttente.splice(i, 1)[0].servir();
}
const lectureDu = (semaine) => (q) => q.nom === 'currency_reports' && q.etat.op === 'select'
  && q.etat.filtres.some((f) => f[1] === 'week_start' && f[2] === semaine);
const CAPTURE = { name: 'capture.png', size: 10 };

test('changer de semaine pendant l envoi d une capture : elle part dans SA semaine, l autre semaine ne l affiche pas', async () => {
  const db = baseRapports({ semaines: DEUX_SEMAINES() });
  const ctx = await ouvrirRapports(db);
  ctx.FileReader = LecteurImmediat;
  db.guichet = true;
  const envoi = ctx.setCurImg('USD', 'pm', CAPTURE);
  for (const nom of ['currency_reports', 'currency_report_entries', 'currency_report_images']) {
    await laisserFiler(); servir(db, (q) => q.nom === nom);
  }
  await laisserFiler();
  assert.ok(db.enAttente.some((q) => q.nom === 'currency_report_images' && q.etat.op === 'insert'), 'témoin : l envoi est en vol');
  const bascule = ctx.selectWeek('2026-10-26', null);
  await laisserFiler();
  servir(db, lectureDu('2026-10-26')); await bascule; // la semaine du 26 s'affiche
  await servirTout(db); await envoi;                 // puis l'envoi du 19 se termine
  const S = lire(ctx, 'S');
  assert.equal(S._rptSemaine, '2026-10-26');
  assert.equal(S._currentRptId, 'r2');
  assert.equal(ctx._curImgCache['pm-USD'], undefined, 'la capture du 19 ne s affiche pas sous le 26');
  const ligne = ecritures(db, 'currency_report_images', 'insert')[0].charge;
  assert.equal(ligne.entry_id, 'e1');
  assert.match(ligne.storage_path, /^currency\/r1\/USD\/pm_/);
  assert.match(ctx.__el('toast').textContent, /sem\. du 19\/10/, 'le message nomme la semaine de la capture');
});

test('changer de semaine pendant que la capture cherche son rapport : la note de la nouvelle semaine reste dans SON rapport', async () => {
  const db = baseRapports({ semaines: DEUX_SEMAINES() });
  const ctx = await ouvrirRapports(db);
  ctx.FileReader = LecteurImmediat;
  db.guichet = true;
  const envoi = ctx.setCurImg('USD', 'pm', CAPTURE);
  await laisserFiler();
  assert.ok(db.enAttente.some(lectureDu('2026-10-19')), 'témoin : la capture cherche le rapport du 19');
  const bascule = ctx.selectWeek('2026-10-26', null);
  await laisserFiler();
  servir(db, lectureDu('2026-10-26')); await bascule; // le 26 se charge d'abord
  await servirTout(db); await envoi;                 // puis l'envoi du 19 se termine
  assert.equal(lire(ctx, 'S')._currentRptId, 'r2');
  db.guichet = false;
  ctx._curNotesCache.USD = 'note du 26';
  await ctx.saveCurrencyReportAuto();
  assert.deepEqual(ecritures(db, 'currency_report_entries', 'update').map((a) => a.filtres[0][2]), ['e2']);
  // Témoin : sans changement de semaine, la capture s'affiche avec son lien
  const db2 = baseRapports();
  const c2 = await ouvrirRapports(db2);
  c2.FileReader = LecteurImmediat;
  await c2.setCurImg('USD', 'pm', CAPTURE);
  assert.equal(c2._curImgCache['pm-USD'].isRemote, true);
  assert.match(c2._curImgCache['pm-USD'].url, /^https:\/\/exemple\.invalid\/signe/);
});

// ─── Constat 52 : remplacer une capture ne détruit pas l'ancienne avant l'heure
// Stockage fictif qui note ses opérations dans db.appels (même fil que la base).
function stockageFictif(db, { refuserEnvoi = false, refuserLien = () => false } = {}) {
  db.storage.from = () => ({
    upload: async (chemin) => {
      db.appels.push({ table: 'storage', op: 'upload', charge: chemin });
      return refuserEnvoi ? { data: null, error: { message: 'The object exceeded the maximum allowed size' } } : { data: {}, error: null };
    },
    remove: async (chemins) => { db.appels.push({ table: 'storage', op: 'remove', charge: horsContexte(chemins) }); return { data: [], error: null }; },
    createSignedUrl: async (chemin) => { db.unitaires.push(chemin); return { data: { signedUrl: 'https://exemple.invalid/signe/' + chemin }, error: null }; },
    createSignedUrls: async (chemins) => { // l'URL porte le numéro du lot
      db.signatures.push([...chemins]);
      const lot = db.signatures.length;
      return { data: chemins.map((p) => (refuserLien(p)
        ? { path: p, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' }
        : { path: p, signedUrl: 'https://exemple.invalid/signe/' + p + '?lot=' + lot, error: null })), error: null };
    },
  });
}
const AVEC_CAPTURE = () => ({ '2026-10-19': { id: 'r1', ws: 'ws-a', entrees: [{ id: 'e1', currency: 'USD', bias: 'bullish', notes: 'note en base',
  images: [{ id: 'i-old', image_type: 'pm', storage_path: 'currency/r1/USD/pm_old.png', created_at: '2026-10-19T08:00:00Z' }] }] } });
const ordre = (db) => db.appels.map((a) => a.table + ':' + a.op);
const zoneVisible = (ctx) => ['cpimg-pm-USD', 'cphint-pm-USD', 'cpz-pm-USD'].forEach((id) => ctx.__creer(id));

test('remplacer une capture : l ancienne n est retirée qu après l enregistrement de la nouvelle', async () => {
  const db = baseRapports({ semaines: AVEC_CAPTURE() });
  const ctx = await ouvrirRapports(db);
  ctx.FileReader = LecteurImmediat; stockageFictif(db);
  await ctx.setCurImg('USD', 'pm', CAPTURE);
  assert.deepEqual(ordre(db), ['storage:upload', 'currency_report_images:insert', 'currency_report_images:delete', 'storage:remove']);
  assert.deepEqual(horsContexte(ecritures(db, 'currency_report_images', 'delete')[0].filtres), [['in', 'id', ['i-old']]]);
  assert.deepEqual(ecritures(db, 'storage', 'remove')[0].charge, ['currency/r1/USD/pm_old.png']);
  assert.equal(ctx._curImgCache['pm-USD'].isRemote, true);
  assert.match(ctx._curImgCache['pm-USD'].path, /^currency\/r1\/USD\/pm_\d+\.png$/);
});

test('envoi d une capture en échec : l ancienne reste en base et revient à l écran, le message le dit', async () => {
  const db = baseRapports({ semaines: AVEC_CAPTURE() });
  const ctx = await ouvrirRapports(db);
  ctx.FileReader = LecteurImmediat; stockageFictif(db, { refuserEnvoi: true }); zoneVisible(ctx);
  const avant = horsContexte(ctx._curImgCache['pm-USD']);
  assert.equal(avant.path, 'currency/r1/USD/pm_old.png', 'témoin : l ancienne capture est affichée');
  await ctx.setCurImg('USD', 'pm', CAPTURE);
  assert.deepEqual(ordre(db), ['storage:upload'], 'rien n est retiré');
  assert.deepEqual(horsContexte(ctx._curImgCache['pm-USD']), avant, 'l ancienne capture revient dans le cache');
  assert.equal(ctx.__el('cpimg-pm-USD').src, avant.url, 'et à l écran');
  assert.ok(!ctx.__el('cpz-pm-USD').classList.contains('uploading'));
  assert.match(ctx.__el('toast').textContent, /^Capture non enregistrée \(USD · Politique Monétaire\) : The object exceeded/);
  // Sans capture précédente : la zone redevient vide (jamais l'aperçu non enregistré)
  const db2 = baseRapports();
  const c2 = await ouvrirRapports(db2);
  c2.FileReader = LecteurImmediat; stockageFictif(db2, { refuserEnvoi: true }); zoneVisible(c2);
  await c2.setCurImg('USD', 'pm', CAPTURE);
  assert.equal(c2._curImgCache['pm-USD'], null);
  assert.ok(!c2.__el('cpz-pm-USD').classList.contains('has-img'));
  assert.equal(c2.__el('cphint-pm-USD').style.display, '');
});

test('ligne de capture refusée après l envoi du fichier : le fichier déposé est retiré, l ancienne capture reste', async () => {
  const db = baseRapports({ semaines: AVEC_CAPTURE(), panne: { 'currency_report_images:insert': true } });
  const ctx = await ouvrirRapports(db);
  ctx.FileReader = LecteurImmediat; stockageFictif(db);
  await ctx.setCurImg('USD', 'pm', CAPTURE);
  assert.deepEqual(ordre(db), ['storage:upload', 'currency_report_images:insert', 'storage:remove']);
  const depose = ecritures(db, 'storage', 'upload')[0].charge;
  assert.deepEqual(ecritures(db, 'storage', 'remove')[0].charge, [depose], 'seul le fichier qui vient d être déposé est retiré');
  assert.equal(ctx._curImgCache['pm-USD'].path, 'currency/r1/USD/pm_old.png');
});

test('deuxième capture sur la même zone pendant un envoi : refusée et dite (pas deux envois croisés)', async () => {
  const db = baseRapports({ semaines: AVEC_CAPTURE() });
  const ctx = await ouvrirRapports(db);
  ctx.FileReader = LecteurImmediat; stockageFictif(db);
  db.guichet = true;
  const premier = ctx.setCurImg('USD', 'pm', CAPTURE);
  await laisserFiler();
  await ctx.setCurImg('USD', 'pm', { name: 'autre.png', size: 10 });
  assert.match(ctx.__el('toast').textContent, /Envoi déjà en cours/);
  await servirTout(db); await premier;
  assert.equal(ecritures(db, 'storage', 'upload').length, 1, 'témoin : le premier envoi a bien eu lieu');
  assert.equal(ecritures(db, 'currency_report_images', 'insert').length, 1);
});

// ─── Constat 53 : « ✕ Supprimer » ne dit « supprimée » que si c'est fait ─────
test('supprimer une capture : refusée en base → elle revient et le message le dit ; acceptée → zone vide et « Capture supprimée »', async () => {
  // Témoin : suppression acceptée (ligne d'abord, fichier ensuite)
  const db = baseRapports({ semaines: AVEC_CAPTURE() });
  const ctx = await ouvrirRapports(db);
  stockageFictif(db); zoneVisible(ctx);
  await ctx.clearCurImg('USD', 'pm');
  assert.deepEqual(ordre(db), ['currency_report_images:delete', 'storage:remove']);
  assert.deepEqual(horsContexte(ecritures(db, 'currency_report_images', 'delete')[0].filtres), [['in', 'id', ['i-old']]]);
  assert.equal(ctx._curImgCache['pm-USD'], null);
  assert.ok(!ctx.__el('cpz-pm-USD').classList.contains('has-img'));
  assert.equal(ctx.__el('toast').textContent, 'Capture supprimée : USD · Politique Monétaire');
  // DELETE refusé (droits, réseau) : la capture revient, le fichier n'est pas touché
  const db2 = baseRapports({ semaines: AVEC_CAPTURE(), panne: { 'currency_report_images:delete': true } });
  const c2 = await ouvrirRapports(db2);
  stockageFictif(db2); zoneVisible(c2);
  const avant = horsContexte(c2._curImgCache['pm-USD']);
  await c2.clearCurImg('USD', 'pm');
  assert.deepEqual(ordre(db2), ['currency_report_images:delete'], 'fichier gardé');
  assert.deepEqual(horsContexte(c2._curImgCache['pm-USD']), avant);
  assert.equal(c2.__el('cpimg-pm-USD').src, avant.url);
  assert.ok(c2.__el('cpz-pm-USD').classList.contains('has-img'));
  assert.match(c2.__el('toast').textContent, /^Capture non supprimée \(USD · Politique Monétaire\) : refus/);
  // Lecture du rapport refusée : rien n'est retiré, et c'est dit aussi
  const db3 = baseRapports({ semaines: AVEC_CAPTURE() });
  const c3 = await ouvrirRapports(db3);
  stockageFictif(db3); zoneVisible(c3);
  db3.panne['currency_reports:select'] = true;
  await c3.clearCurImg('USD', 'pm');
  assert.deepEqual(db3.appels, []);
  assert.equal(c3._curImgCache['pm-USD'].path, 'currency/r1/USD/pm_old.png');
  assert.match(c3.__el('toast').textContent, /^Capture non supprimée/);
});

test('supprimer une capture pendant son envoi : refusé et dit (elle ne réapparaît pas après coup)', async () => {
  const db = baseRapports();
  const ctx = await ouvrirRapports(db);
  ctx.FileReader = LecteurImmediat; stockageFictif(db); zoneVisible(ctx);
  db.guichet = true;
  const envoi = ctx.setCurImg('USD', 'pm', CAPTURE);
  await laisserFiler();
  assert.ok(ctx.__el('cpz-pm-USD').classList.contains('uploading'), 'témoin : envoi en cours');
  await ctx.clearCurImg('USD', 'pm');
  assert.match(ctx.__el('toast').textContent, /Envoi en cours : attends la fin/);
  await servirTout(db); await envoi;
  assert.equal(ctx._curImgCache['pm-USD'].isRemote, true, 'la capture envoyée est affichée, comme annoncé');
  assert.match(ctx.__el('toast').textContent, /Envoi en cours : attends la fin/, 'l avertissement reste lisible');
  ctx.actionUtilisateur(); // ta prochaine action (ou 8 s) : le message en attente passe
  assert.match(ctx.__el('toast').textContent, /^Capture enregistrée/);
  assert.equal(ecritures(db, 'currency_report_images', 'delete').length, 0);
});

// ─── Constat 62 (message) : la capture annoncée est celle de la zone déposée ─
test('message d une capture : la zone déposée est nommée (BILAN : plus « Graphique Hebdo » pour tout)', async () => {
  const db = baseRapports({ semaines: { '2026-10-19': { id: 'r1', ws: 'ws-a', entrees: [] } } });
  const ctx = await ouvrirRapports(db);
  ctx.FileReader = LecteurImmediat; stockageFictif(db);
  const titres = { var: 'Variation / Classement devise', vix: 'Sentiment du risque (VIX)', idx: 'Indice boursier', fng: 'Fear and Greed Index' };
  for (const [zone, titre] of Object.entries(titres)) {
    await ctx.setCurImg('BILAN', zone, CAPTURE);
    assert.equal(ctx.__el('toast').textContent, 'Capture enregistrée : BILAN · ' + titre + ' — sem. du 19/10 ✅');
  }
  // Témoin : les deux zones d'une devise
  await ctx.setCurImg('USD', 'pm', CAPTURE);
  assert.equal(ctx.__el('toast').textContent, 'Capture enregistrée : USD · Politique Monétaire — sem. du 19/10 ✅');
  await ctx.setCurImg('USD', 'gh', CAPTURE);
  assert.equal(ctx.__el('toast').textContent, 'Capture enregistrée : USD · Graphique Hebdomadaire — sem. du 19/10 ✅');
});

// ─── AJOUT 1 et constat 57 : une semaine = un lundi, et c'est elle qui est surlignée
const boutonsSemaine = (ctx) => ctx.__el('rpt-week-btns').children;
const semainesActives = (ctx) => boutonsSemaine(ctx).filter((b) => b.classList.contains('active')).map((b) => b.dataset.week);
// Liste des semaines qui se comporte comme le DOM : lastElementChild suit ses
// enfants (inerte, il vaut null) et innerHTML='' les retire (reconstruction).
function listeSemaines(ctx) {
  const el = ctx.__creer('rpt-week-btns');
  Object.defineProperty(el, 'lastElementChild', { get() { return this.children[this.children.length - 1] || null; } });
  let html = '';
  Object.defineProperty(el, 'innerHTML', { get: () => html, set(v) { html = String(v); if (!html) this.children.length = 0; } });
  return el;
}

test('Rapports en début de mois : le mois affiché est celui du lundi courant, et c est SA semaine qui est surlignée', () => {
  const ctx = charger({ maintenant: new Date('2026-10-01T10:00:00+02:00'), muet: true }); // jeudi 1er octobre
  listeSemaines(ctx);
  ctx.buildRptMonthBar();
  assert.equal(lire(ctx, 'S_rptMonth'), '2026-09');
  assert.equal(ctx.__el('rpt-week').value, '2026-09-28');
  assert.equal(ctx.__el('rpt-month-pick').value, '2026-09');
  const moisActifs = ctx.__el('rpt-month-btns').children.filter((b) => b.classList.contains('active')).map((b) => b.dataset.month);
  assert.deepEqual(moisActifs, ['2026-09']);
  assert.deepEqual(semainesActives(ctx), ['2026-09-28']);
  assert.match(boutonsSemaine(ctx).find((b) => b.dataset.week === '2026-09-28').innerHTML, /◆/, 'la semaine courante porte ◆');
  // Témoin : au 20/10, octobre et la semaine du 19
  const c2 = charger({ maintenant: new Date('2026-10-20T10:00:00+02:00'), muet: true });
  listeSemaines(c2);
  c2.buildRptMonthBar();
  assert.equal(lire(c2, 'S_rptMonth'), '2026-10');
  assert.deepEqual(semainesActives(c2), ['2026-10-19']);
});

test('liste des semaines d un mois qui ne contient pas la semaine chargée : aucun bouton surligné à tort', () => {
  const ctx = charger({ maintenant: new Date('2026-10-20T10:00:00+02:00'), muet: true });
  listeSemaines(ctx);
  ctx.__el('rpt-week').value = '2026-09-28';
  ctx.buildWeeksForMonth('2026-10');
  assert.equal(boutonsSemaine(ctx).length, 4, 'témoin : les 4 lundis d octobre sont listés');
  assert.deepEqual(semainesActives(ctx), []);
  assert.equal(ctx.__el('rpt-week').value, '2026-09-28', 'la semaine chargée ne change pas');
});

test('date de semaine sur un mercredi : ramenée au lundi, et dit ; le mois et le bouton suivent ; le bon rapport est lu', async () => {
  const db = baseRapports({ semaines: DEUX_SEMAINES() });
  const ctx = await ouvrirRapports(db);
  listeSemaines(ctx); ctx.buildWeeksForMonth('2026-10');
  ctx.__el('rpt-week').value = '2026-10-28'; // mercredi
  await ctx.onWeekDateChange();
  assert.equal(ctx.__el('rpt-week').value, '2026-10-26');
  assert.match(ctx.__el('toast').textContent, /^Semaine du lundi 26\/10/);
  // v=6 : la date exacte est d'abord cherchée (ancien rapport hors lundi ?), puis le lundi lu
  assert.deepEqual(semainesLues(db), ['2026-10-19', '2026-10-28', '2026-10-26']);
  assert.equal(ctx._curNotesCache.USD, 'semaine suivante', 'le rapport du lundi s affiche');
  assert.deepEqual(semainesActives(ctx), ['2026-10-26']);
  // Mercredi 30/09 : son lundi (28/09) est en septembre → le mois suit
  ctx.__el('rpt-week').value = '2026-09-30';
  await ctx.onWeekDateChange();
  assert.equal(ctx.__el('rpt-week').value, '2026-09-28');
  assert.equal(lire(ctx, 'S_rptMonth'), '2026-09');
  assert.equal(ctx.__el('rpt-month-pick').value, '2026-09');
  assert.deepEqual(semainesActives(ctx), ['2026-09-28']);
  // Témoin : un lundi reste tel quel, sans message
  ctx.__el('toast').textContent = '';
  ctx.__el('rpt-week').value = '2026-09-21';
  await ctx.onWeekDateChange();
  assert.equal(ctx.__el('rpt-week').value, '2026-09-21');
  assert.equal(ctx.__el('toast').textContent, '');
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-09-21');
});

// Vérifié en base (11/11/2026) : d'anciens rapports sont datés d'un dimanche ou d'un
// samedi (ancien calcul de date en UTC). Ramener au lundi les rendrait inaccessibles :
// un rapport enregistré EXACTEMENT à la date choisie s'ouvre, avec un avertissement.
test('date hors lundi où un ancien rapport existe : il s ouvre tel quel, avertissement à l appui ; sinon ramenée au lundi', async () => {
  const semaines = { ...DEUX_SEMAINES(), '2026-10-25': { id: 'r-dim', ws: 'ws-a', entrees: [{ id: 'e-dim', currency: 'USD', bias: null, notes: 'ancien du dimanche', images: [] }] } };
  const db = baseRapports({ semaines });
  const ctx = await ouvrirRapports(db);
  listeSemaines(ctx); ctx.buildWeeksForMonth('2026-10');
  ctx.__el('rpt-week').value = '2026-10-25'; // dimanche, rapport existant
  await ctx.onWeekDateChange();
  assert.equal(ctx.__el('rpt-week').value, '2026-10-25', 'la date choisie est gardée');
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-10-25');
  assert.equal(ctx._curNotesCache.USD, 'ancien du dimanche', 'l ancien rapport est lisible');
  assert.match(ctx.__el('toast').textContent, /Ancien rapport enregistré sous le 25\/10 \(pas un lundi\)/);
  // Témoin : l'ancien rapport du dimanche appartient à un AUTRE espace → ramené au lundi
  const db2 = baseRapports({ semaines: { ...DEUX_SEMAINES(), '2026-10-25': { id: 'r-dim-b', ws: 'ws-b', entrees: [{ id: 'e-dim-b', currency: 'USD', bias: null, notes: 'autre espace', images: [] }] } } });
  const ctx2 = await ouvrirRapports(db2);
  listeSemaines(ctx2); ctx2.buildWeeksForMonth('2026-10');
  ctx2.__el('rpt-week').value = '2026-10-25';
  await ctx2.onWeekDateChange();
  assert.equal(ctx2.__el('rpt-week').value, '2026-10-19');
  assert.equal(ctx2._curNotesCache.USD, 'note en base');
});

// ─── AJOUT 6 : page restée ouverte d'une semaine à l'autre ────────────────────
const TROIS_SEMAINES = () => ({
  '2026-10-05': { id: 'r0', ws: 'ws-a', entrees: [{ id: 'e05', currency: 'USD', bias: null, notes: 'semaine du 5', images: [] }] },
  '2026-10-12': { id: 'r12', ws: 'ws-a', entrees: [{ id: 'e12', currency: 'USD', bias: null, notes: 'semaine du 12', images: [] }] },
  '2026-10-19': { id: 'r1', ws: 'ws-a', entrees: [{ id: 'e1', currency: 'USD', bias: null, notes: 'semaine du 19', images: [] }] },
});
// Démarrage le dimanche 18/10 au soir (semaine du 12), horloge que le test fait avancer.
async function ouvertDimancheSoir(db) {
  const maintenant = new Date('2026-10-18T22:00:00+02:00');
  const ctx = charger({ maintenant, db, muet: true });
  const S = lire(ctx, 'S');
  S.workspaceId = 'ws-a'; S.currentWorkspaceId = 'ws-a';
  listeSemaines(ctx);
  ctx.buildRptMonthBar();
  await ctx.loadCurrencyReport();
  return { ctx, maintenant };
}
const semaineAuDiamant = (ctx) => boutonsSemaine(ctx).filter((b) => b.innerHTML.includes('◆')).map((b) => b.dataset.week);

test('page restée ouverte du dimanche au lundi : rouvrir Rapports enregistre l ancienne semaine puis ouvre la nouvelle (◆)', async () => {
  const db = baseRapports({ semaines: TROIS_SEMAINES() });
  const { ctx, maintenant } = await ouvertDimancheSoir(db);
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-10-12', 'témoin : dimanche, semaine du 12');
  assert.deepEqual(semaineAuDiamant(ctx), ['2026-10-12']);
  ctx._curNotesCache.USD = 'tapé dimanche soir';
  maintenant.setTime(new Date('2026-10-19T09:00:00+02:00').getTime()); // lundi matin
  await ctx.loadCurrencyReport(); // clic sur l'onglet Rapports
  assert.deepEqual(ecritures(db, 'currency_report_entries', 'update').map((a) => [a.filtres[0][2], a.charge.notes]), [['e12', 'tapé dimanche soir']]);
  assert.equal(ctx.__el('rpt-week').value, '2026-10-19');
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-10-19');
  assert.deepEqual(semaineAuDiamant(ctx), ['2026-10-19']);
  assert.deepEqual(semainesActives(ctx), ['2026-10-19']);
});

test('page restée ouverte : une semaine choisie par l utilisateur reste ouverte, seul ◆ se déplace', async () => {
  const db = baseRapports({ semaines: TROIS_SEMAINES() });
  const { ctx, maintenant } = await ouvertDimancheSoir(db);
  await ctx.selectWeek('2026-10-05', null);
  maintenant.setTime(new Date('2026-10-19T09:00:00+02:00').getTime());
  await ctx.loadCurrencyReport();
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-10-05');
  assert.deepEqual(semainesActives(ctx), ['2026-10-05']);
  assert.deepEqual(semaineAuDiamant(ctx), ['2026-10-19']);
});

// ─── AJOUT 7 : liens signés renouvelés après expiration (en un lot) ──────────
const CAPTURES_SEMAINE = () => ({ '2026-10-19': { id: 'r1', ws: 'ws-a', entrees: [
  { id: 'e1', currency: 'USD', bias: null, notes: '', images: [{ id: 'i1', image_type: 'pm', storage_path: 'currency/r1/USD/pm_1.png', created_at: '2026-10-19T08:00:00Z' }] },
  { id: 'e2', currency: 'EUR', bias: null, notes: '', images: [
    { id: 'i2', image_type: 'pm', storage_path: 'currency/r1/EUR/pm_1.png', created_at: '2026-10-19T08:00:00Z' },
    { id: 'i3', image_type: 'gh', storage_path: 'currency/r1/EUR/gh_1.png', created_at: '2026-10-19T08:00:00Z' }] },
  { id: 'e3', currency: 'BILAN', bias: null, notes: '', images: [{ id: 'i4', image_type: 'fng', storage_path: 'currency/r1/BILAN/fng_1.png', created_at: '2026-10-19T08:00:00Z' }] },
] } });
const zonesVisibles = (ctx, code, zones) => zones.forEach((z) => ['cpimg-', 'cphint-', 'cpz-'].forEach((p) => ctx.__creer(p + z + '-' + code)));

test('lien signé d une capture de plus de 50 min : renouvelé en UN lot (toutes les captures périmées) avant affichage', async () => {
  const maintenant = new Date(LUNDI);
  const db = baseRapports({ semaines: CAPTURES_SEMAINE() });
  const ctx = await ouvrirRapports(db, { maintenant });
  stockageFictif(db);
  assert.equal(db.signatures.length, 1, 'témoin : un lot au chargement');
  zonesVisibles(ctx, 'EUR', ['pm', 'gh']);
  // 10 min plus tard : liens encore valides, rien à signer
  maintenant.setTime(maintenant.getTime() + 10 * 60000);
  injecter(ctx, { S_curCode: 'EUR' }); ctx.renderCurrencyView(); await laisserFiler();
  assert.equal(db.signatures.length, 1);
  assert.equal(ctx.__el('cpimg-pm-EUR').src, 'https://exemple.invalid/signe/currency/r1/EUR/pm_1.png');
  // 2 h plus tard : la zone attend (pas de lien expiré à l'écran), puis UN lot
  maintenant.setTime(maintenant.getTime() + 2 * 3600000);
  ctx.renderCurrencyView();
  assert.equal(ctx.__el('cpimg-pm-EUR').src, '', 'le lien expiré n est pas affiché');
  assert.ok(ctx.__el('cpz-pm-EUR').classList.contains('has-img'), 'la zone reste marquée « avec capture »');
  await laisserFiler();
  assert.equal(db.signatures.length, 2);
  assert.deepEqual([...db.signatures[1]].sort(), ['currency/r1/BILAN/fng_1.png', 'currency/r1/EUR/gh_1.png', 'currency/r1/EUR/pm_1.png', 'currency/r1/USD/pm_1.png']);
  assert.equal(db.unitaires.length, 0, 'jamais un lien par image');
  assert.equal(ctx.__el('cpimg-pm-EUR').src, 'https://exemple.invalid/signe/currency/r1/EUR/pm_1.png?lot=2');
  assert.equal(ctx.__el('cpimg-gh-EUR').src, 'https://exemple.invalid/signe/currency/r1/EUR/gh_1.png?lot=2');
  // Le BILAN, renouvelé dans le même lot, s'affiche sans nouvelle requête
  injecter(ctx, { S_curCode: 'BILAN' }); ctx.renderBilanView(); await laisserFiler();
  assert.equal(db.signatures.length, 2);
});

test('lien impossible à renouveler, ou image qui ne se charge pas : « Capture indisponible », pas une image cassée', async () => {
  const maintenant = new Date(LUNDI);
  const db = baseRapports({ semaines: CAPTURES_SEMAINE() });
  const ctx = await ouvrirRapports(db, { maintenant });
  stockageFictif(db, { refuserLien: (p) => p.includes('/USD/') });
  zonesVisibles(ctx, 'USD', ['pm', 'gh']);
  const txt = { innerHTML: '📋 Ctrl+V · Cliquer · Glisser' };
  ctx.__el('cphint-pm-USD').querySelector = () => txt;
  maintenant.setTime(maintenant.getTime() + 2 * 3600000);
  ctx.renderCurrencyView(); await laisserFiler();
  assert.equal(db.signatures.length, 2, 'témoin : le renouvellement a été tenté');
  assert.match(txt.innerHTML, /Capture indisponible/);
  assert.equal(ctx.__el('cphint-pm-USD').style.display, '');
  assert.equal(ctx.__el('cpimg-pm-USD').src, '');
  // Filet : une image qui échoue au chargement le dit ; une zone vide (src vide) non
  const vue = ctx.__el('cur-single-view').innerHTML;
  assert.match(vue, /id="cpimg-pm-USD"[^>]*onerror="captureIndisponible\(this\)"/);
  assert.match(vue, /id="cpimg-gh-USD"[^>]*onerror="captureIndisponible\(this\)"/);
  const txtGh = { innerHTML: 'invite' };
  ctx.__el('cphint-gh-USD').querySelector = () => txtGh;
  ctx.captureIndisponible(ctx.__el('cpimg-gh-USD'));
  assert.equal(txtGh.innerHTML, 'invite', 'src vide : pas une erreur');
  ctx.__el('cpimg-gh-USD').setAttribute('src', 'https://exemple.invalid/x.png');
  ctx.captureIndisponible(ctx.__el('cpimg-gh-USD'));
  assert.match(txtGh.innerHTML, /Capture indisponible/);
  // Une fois la zone vidée, l'invite d'origine revient
  ctx.montrerCapture('USD', 'pm', null);
  assert.equal(txt.innerHTML, '📋 Ctrl+V · Cliquer · Glisser');
});

// ─── Constat 58 : changer d'espace (admin) depuis Rapports ───────────────────
const DEUX_ESPACES = () => ({
  b: { semaine: '2026-10-19', id: 'r-ws-b', ws: 'ws-b', entrees: [{ id: 'eb', currency: 'USD', bias: null, notes: 'rapport de B', images: [] }] },
  a: { semaine: '2026-10-19', id: 'r-ws-a', ws: 'ws-a', entrees: [{ id: 'ea', currency: 'USD', bias: null, notes: 'rapport de A', images: [] }] },
});
// Un super-admin consulte le rapport de l'espace « Équipe B » (le sien est ws-a).
async function adminSurEspaceB(db, { rapportsOuvert = true } = {}) {
  const ctx = charger({ maintenant: new Date(LUNDI), db, muet: true });
  const S = lire(ctx, 'S');
  S.isSuperAdmin = true; S.workspaceId = 'ws-a'; S.currentWorkspaceId = 'ws-b';
  S.availableWorkspaces = [{ id: 'ws-a', name: 'Perso', is_shared: false }, { id: 'ws-b', name: 'Équipe B', is_shared: true }];
  S.currentWorkspace = S.availableWorkspaces[1];
  ctx.__el('rpt-week').value = '2026-10-19';
  if (rapportsOuvert) ctx.__el('sec-currency').classList.add('active');
  await ctx.loadCurrencyReport();
  return ctx;
}
const majEntrees = (db) => ecritures(db, 'currency_report_entries', 'update').map((a) => [a.filtres[0][2], a.charge.notes]);

test('admin : changer d espace depuis Rapports écrit la saisie dans SON espace, puis affiche le rapport du nouvel espace', async () => {
  const db = baseRapports({ semaines: DEUX_ESPACES() });
  const ctx = await adminSurEspaceB(db);
  const S = lire(ctx, 'S');
  assert.equal(S._currentRptId, 'r-ws-b', 'témoin : le rapport de B est affiché');
  ctx._curNotesCache.USD = 'tapé dans B';
  await ctx.switchCurrentWorkspace('ws-a');
  await laisserFiler();
  assert.deepEqual(majEntrees(db), [['eb', 'tapé dans B']], 'écrit dans B avant la bascule');
  assert.equal(S._currentRptId, 'r-ws-a');
  assert.equal(S._rptWs, 'ws-a');
  assert.match(ctx.__el('cur-single-view').innerHTML, /rapport de A/);
  ctx._curNotesCache.USD = 'tapé dans A';
  await ctx.saveCurrencyReportAuto();
  assert.deepEqual(majEntrees(db), [['eb', 'tapé dans B'], ['ea', 'tapé dans A']]);
});

test('admin : changer d espace ailleurs que sur Rapports ne laisse pas le rapport de l ancien espace en place', async () => {
  const db = baseRapports({ semaines: DEUX_ESPACES() });
  const ctx = await adminSurEspaceB(db, { rapportsOuvert: false });
  assert.match(ctx.__el('cur-single-view').innerHTML, /rapport de B/, 'témoin');
  await ctx.switchCurrentWorkspace('ws-a');
  await laisserFiler();
  const S = lire(ctx, 'S');
  assert.equal(S._currentRptId, null);
  assert.ok(!ctx.__el('cur-single-view').innerHTML.includes('rapport de B'));
  assert.equal(ctx._curNotesCache.USD, undefined);
  await ctx.loadCurrencyReport(); // clic sur l'onglet Rapports
  assert.equal(S._currentRptId, 'r-ws-a');
});

test('admin : changer d espace après un échec d enregistrement : rien ne change, on demande avant d abandonner', async () => {
  const db = baseRapports({ semaines: DEUX_ESPACES(), panne: { 'currency_report_entries:update': true } });
  const ctx = await adminSurEspaceB(db);
  const S = lire(ctx, 'S');
  ctx._curNotesCache.USD = 'tapé dans B';
  await ctx.switchCurrentWorkspace('ws-a');
  assert.equal(S.currentWorkspaceId, 'ws-b');
  assert.equal(S._currentRptId, 'r-ws-b');
  assert.equal(ctx._curNotesCache.USD, 'tapé dans B');
  assert.match(ctx.__el('confirm-msg').textContent, /n'est pas en base/);
  ctx.execConfirm(); // « Abandonner ma saisie »
  await laisserFiler();
  assert.equal(S.currentWorkspaceId, 'ws-a');
  assert.equal(S._currentRptId, 'r-ws-a');
});

// Intégration v=6 (constats 3 + 58) : un changement d'espace dont une lecture
// échoue revient à la vue d'avant (restaurerVue) ; le rapport doit la suivre.
test('admin : changement d espace en échec depuis Rapports : le rapport revient avec la vue, la saisie part dans l espace affiché', async () => {
  const db = baseRapports({ semaines: DEUX_ESPACES(), panne: { 'trades:select': true } });
  const ctx = await adminSurEspaceB(db);
  const S = lire(ctx, 'S');
  assert.equal(S._currentRptId, 'r-ws-b', 'témoin : le rapport de B est affiché');
  await ctx.switchCurrentWorkspace('ws-a');
  await laisserFiler();
  assert.equal(S.currentWorkspaceId, 'ws-b', 'témoin : lecture des trades en échec, la vue revient sur B');
  assert.equal(S._rptWs, 'ws-b', 'le rapport suit la vue remise en place');
  assert.equal(S._currentRptId, 'r-ws-b');
  assert.equal(S._rptCharge, true, 'le rapport de B est relu, donc modifiable');
  assert.match(ctx.__el('cur-single-view').innerHTML, /rapport de B/);
  assert.doesNotMatch(ctx.__el('cur-single-view').innerHTML, /rapport de A/);
  ctx._curNotesCache.USD = 'tapé dans B';
  await ctx.saveCurrencyReportAuto();
  assert.deepEqual(majEntrees(db), [['eb', 'tapé dans B']], 'la saisie part dans B, l espace affiché, jamais dans A');
});

// ─── Constat 63 : les toasts ne recouvrent plus l'indicateur d'auto-save ──────
// Hauteurs mesurées dans Chromium (styles.css du jour, 1280/820/390 px) : toast
// 31 px pour une ligne, +12 px par ligne (54 px pour 3 lignes sur iPhone) ;
// présence 23 px. Le banc reste la référence pour le rendu.
test('styles : l indicateur d auto-save est au-dessus de la zone des toasts (4 lignes) et de la présence', () => {
  const css = fs.readFileSync(path.join(RACINE, 'styles.css'), 'utf8');
  const bas = (sel) => {
    const regle = new RegExp('(^|\\n)' + sel + '\\{([^}]*)\\}').exec(css);
    assert.ok(regle, 'témoin : règle ' + sel + ' trouvée');
    return +(/bottom:(\d+)px/.exec(regle[2]) || [])[1];
  };
  const toast = bas('#toast'), presence = bas('#presence-indicator'), indic = bas('#autosave-indicator');
  assert.equal(toast, 18, 'témoin : toast ancré à 18 px');
  assert.equal(presence, 42, 'témoin : présence ancrée à 42 px');
  const TOAST_4_LIGNES = 31 + 3 * 12, PRESENCE = 23;
  assert.ok(indic >= toast + TOAST_4_LIGNES, 'au-dessus d un toast de 4 lignes (' + indic + ' px)');
  assert.ok(indic >= presence + PRESENCE, 'au-dessus de la présence');
});

// ─── Constat 48 (suite) : fermer la page avec une saisie non enregistrée ─────
test('fermer ou recharger la page pendant un enregistrement, ou après un échec : le navigateur demande ; sinon non', async () => {
  const fermer = (ctx) => { const e = { empeche: false, preventDefault() { this.empeche = true; }, returnValue: undefined }; ctx.avantFermeture(e); return e.empeche; };
  const db = baseRapports({ panne: { 'currency_report_entries:update': true } });
  const ctx = await ouvrirRapports(db);
  assert.equal(fermer(ctx), false, 'rien de tapé : pas de question');
  ctx._curNotesCache.USD = 'note tapée';
  ctx.scheduleAutoSave(); // frappe : enregistrement dans 1 s
  assert.equal(fermer(ctx), true, 'frappe pas encore enregistrée');
  await ctx.saveCurrencyReportAuto();
  assert.equal(indicateur(ctx).className, 'error', 'témoin : l enregistrement a échoué');
  assert.equal(fermer(ctx), true, 'saisie refusée par la base');
  db.panne['currency_report_entries:update'] = false;
  await ctx.saveCurrencyReportAuto();
  assert.equal(fermer(ctx), false, 'tout est écrit : pas de question');
  assert.match(sansCommentaires(SOURCE_APP), /window\.addEventListener\('beforeunload',avantFermeture\);/, 'la garde est branchée');
});
