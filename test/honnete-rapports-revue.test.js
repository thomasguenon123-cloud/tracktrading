'use strict';
// v=6 (revue adverse) — Rapports : chaque garde APPELLE le code et porte un
// temoin positif ; elle doit ECHOUER sur l'integration si le defaut est reel.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const H = require('./aides-rapports.js');
const { assert, lire, laisserFiler, baseRapports, servirTout, ouvrirRapports, indicateur, notesEcrites, servir } = H;

const DEUX_SEMAINES = () => ({
  '2026-10-19': { id: 'r1', ws: 'ws-a', entrees: [{ id: 'e1', currency: 'USD', bias: 'bullish', notes: 'note en base', images: [] }] },
  '2026-10-26': { id: 'r2', ws: 'ws-a', entrees: [{ id: 'e2', currency: 'USD', bias: 'bearish', notes: 'semaine suivante', images: [] }] },
});
const fermer = (ctx) => { const e = { empeche: false, preventDefault() { this.empeche = true; }, returnValue: undefined }; ctx.avantFermeture(e); return e.empeche; };

// R1 — L'auto-save a écrit la note ; il ne lui reste que la mise à jour de la date
// du rapport (currency_reports.update) quand l'utilisateur clique une autre semaine.
test('R1 : changer de semaine pendant la fin d un auto-save ne laisse pas « En cours… » pour toujours (ni question à la fermeture)', async () => {
  // Témoin positif : même enregistrement, sans changement de semaine → « ✓ Sauvegardé »
  const dbT = baseRapports({ semaines: DEUX_SEMAINES() });
  const t = await ouvrirRapports(dbT);
  dbT.guichet = true;
  t._curNotesCache.USD = 'saisie du 19';
  const aT = t.saveCurrencyReportAuto();
  await servirTout(dbT); await aT;
  assert.equal(indicateur(t).textContent, '✓ Sauvegardé', 'témoin');

  const db = baseRapports({ semaines: DEUX_SEMAINES() });
  const ctx = await ouvrirRapports(db);
  db.guichet = true;
  ctx._curNotesCache.USD = 'saisie du 19';
  const auto = ctx.saveCurrencyReportAuto(); // la minuterie de 1 s s'est déclenchée
  await laisserFiler(); servir(db, (q) => q.nom === 'currency_report_entries' && q.etat.op === 'select');
  await laisserFiler(); servir(db, (q) => q.nom === 'currency_report_entries' && q.etat.op === 'update');
  await laisserFiler();
  assert.ok(db.enAttente.some((q) => q.nom === 'currency_reports' && q.etat.op === 'update'), 'témoin : seule la date du rapport reste en vol');
  assert.equal(indicateur(ctx).textContent, '● En cours…');
  const bascule = ctx.selectWeek('2026-10-26', null); // clic sur la semaine suivante
  await servirTout(db); await bascule; await auto;
  assert.deepEqual(notesEcrites(db), ['saisie du 19'], 'la saisie EST en base');
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-10-26', 'la semaine suivante est affichée');
  assert.notEqual(indicateur(ctx).className, 'saving', 'indicateur bloqué sur « ' + indicateur(ctx).textContent + ' » alors que tout est écrit');
  assert.equal(fermer(ctx), false, 'fermer la page demande confirmation alors que rien n attend');
});

// R2 — Une frappe annulée (tapée puis effacée) avant la fin de la minuterie : la
// saisie est identique à la base, on change de semaine.
test('R2 : une frappe effacée puis un changement de semaine ne laissent pas « En cours… » ni de question à la fermeture', async () => {
  const db = baseRapports({ semaines: DEUX_SEMAINES() });
  const ctx = await ouvrirRapports(db);
  ctx._curNotesCache.USD = 'note en basex'; ctx.scheduleAutoSave(); // frappe « x »
  ctx._curNotesCache.USD = 'note en base'; ctx.scheduleAutoSave();  // retour arrière
  assert.equal(fermer(ctx), true, 'témoin : frappe en attente → question légitime');
  await ctx.selectWeek('2026-10-26', null); // dans la seconde
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-10-26', 'témoin : la bascule a eu lieu');
  assert.equal(db.appels.length, 0, 'rien à écrire (la saisie était identique à la base)');
  assert.notEqual(indicateur(ctx).className, 'saving', 'indicateur bloqué sur « ' + indicateur(ctx).textContent + ' »');
  assert.equal(fermer(ctx), false, 'question à la fermeture sans saisie en attente');
});

// R3 — Choisir dans le champ date un jour d'un autre mois : la liste des semaines
// et la liste des mois passent au mois de ce lundi, mais le BOUTON de mois de
// l'ancien mois reste surligné.
test('R3 : date choisie dans un autre mois → le bouton de mois surligné est celui du mois affiché', async () => {
  const db = baseRapports({ semaines: DEUX_SEMAINES() });
  const ctx = H.charger({ maintenant: new Date('2026-10-20T10:00:00+02:00'), db, muet: true });
  const S = lire(ctx, 'S'); S.workspaceId = 'ws-a'; S.currentWorkspaceId = 'ws-a';
  H.listeSemaines(ctx);
  ctx.buildRptMonthBar();
  await ctx.loadCurrencyReport();
  const moisActifs = () => ctx.__el('rpt-month-btns').children.filter((b) => b.classList.contains('active')).map((b) => b.dataset.month);
  assert.deepEqual(moisActifs(), ['2026-10'], 'témoin : octobre surligné au départ');
  assert.equal(ctx.__el('rpt-month-btns').children.length, 3, 'témoin : OCT, SEPT, AOÛT');
  ctx.__el('rpt-week').value = '2026-09-16'; // mercredi 16/09 choisi dans le champ date
  await ctx.onWeekDateChange();
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-09-14', 'la semaine du 14/09 est chargée');
  assert.equal(ctx.__el('rpt-month-pick').value, '2026-09', 'la liste des mois dit septembre');
  assert.deepEqual(H.semainesActives(ctx), ['2026-09-14'], 'les boutons de semaine sont ceux de septembre');
  assert.deepEqual(moisActifs(), ['2026-09'], 'bouton de mois surligné : ' + JSON.stringify(moisActifs()) + ' (septembre affiché)');
});

// R4 — Lecture du rapport réussie, mais la signature des liens de capture échoue
// (réseau) : les zones s'affichent VIDES (« Ctrl+V · Cliquer · Glisser »).
const AVEC_CAPTURE = () => ({ '2026-10-19': { id: 'r1', ws: 'ws-a', entrees: [{ id: 'e1', currency: 'USD', bias: 'bullish', notes: 'note en base',
  images: [{ id: 'i-old', image_type: 'pm', storage_path: 'currency/r1/USD/pm_old.png', created_at: '2026-10-19T08:00:00Z' }] }] } });
async function ouvrirAvecSignature(signer) {
  const db = baseRapports({ semaines: AVEC_CAPTURE() });
  const base = db.storage.from();
  db.storage.from = () => ({ ...base, createSignedUrls: signer });
  const ctx = H.charger({ maintenant: new Date(H.LUNDI), db, muet: true });
  const S = lire(ctx, 'S'); S.workspaceId = 'ws-a'; S.currentWorkspaceId = 'ws-a';
  ['cpimg-pm-USD', 'cphint-pm-USD', 'cpz-pm-USD'].forEach((id) => ctx.__creer(id));
  const txt = { innerHTML: '📋 Ctrl+V · Cliquer · Glisser' };
  ctx.__el('cphint-pm-USD').querySelector = () => txt;
  ctx.__el('rpt-week').value = '2026-10-19';
  await ctx.loadCurrencyReport();
  return { ctx, txt };
}
test('R4 : signature des captures en échec au chargement → la zone ne se présente pas comme vide', async () => {
  // Témoin positif : signature acceptée → la capture s'affiche
  const ok = await ouvrirAvecSignature(async (chemins) => ({ data: chemins.map((p) => ({ path: p, signedUrl: 'https://exemple.invalid/s/' + p, error: null })), error: null }));
  assert.equal(ok.ctx.__el('cpimg-pm-USD').src, 'https://exemple.invalid/s/currency/r1/USD/pm_old.png', 'témoin');
  assert.ok(ok.ctx.__el('cpz-pm-USD').classList.contains('has-img'), 'témoin');
  // Panne réseau sur createSignedUrls
  const { ctx, txt } = await ouvrirAvecSignature(async () => ({ data: null, error: { message: 'Failed to fetch' } }));
  assert.match(ctx.__el('cur-single-view').innerHTML, /note en base/, 'le texte du rapport est bien affiché');
  const vide = !ctx.__el('cpz-pm-USD').classList.contains('has-img') && ctx.__el('cphint-pm-USD').style.display !== 'none' && !/indisponible/i.test(txt.innerHTML);
  assert.equal(vide, false, 'zone affichée vide (« ' + txt.innerHTML + ' ») alors qu une capture existe en base');
});

// R5 — Page restée ouverte du samedi 31/10 au lundi 2/11 avec une semaine choisie
// (AJOUT 6) : la semaine courante (◆, 2/11) est dans un mois que la barre des mois
// ne propose pas (construite le 31/10 : OCT, SEPT, AOÛT ; liste oct. 2026 → mai 2025).
test('R5 : page ouverte d un mois sur l autre avec une semaine choisie → la semaine courante reste atteignable (◆ ou mois proposé)', async () => {
  const semaines = { '2026-10-19': { id: 'r1', ws: 'ws-a', entrees: [] }, '2026-10-26': { id: 'r2', ws: 'ws-a', entrees: [] }, '2026-11-02': { id: 'r3', ws: 'ws-a', entrees: [] } };
  const ouvrir = async () => {
    const maintenant = new Date('2026-10-31T10:00:00+01:00');
    const db = baseRapports({ semaines });
    const ctx = H.charger({ maintenant, db, muet: true });
    const S = lire(ctx, 'S'); S.workspaceId = 'ws-a'; S.currentWorkspaceId = 'ws-a';
    H.listeSemaines(ctx); ctx.buildRptMonthBar(); await ctx.loadCurrencyReport();
    return { ctx, maintenant };
  };
  const diamant = (ctx) => H.boutonsSemaine(ctx).filter((b) => b.innerHTML.includes('◆')).map((b) => b.dataset.week);
  const moisProposes = (ctx) => ctx.__el('rpt-month-pick').children.map((o) => o.value);
  // Témoin : sans semaine choisie, lundi 2/11 → la nouvelle semaine s'ouvre, ◆ dessus
  const t = await ouvrir();
  t.maintenant.setTime(new Date('2026-11-02T09:00:00+01:00').getTime());
  await t.ctx.loadCurrencyReport();
  assert.equal(lire(t.ctx, 'S')._rptSemaine, '2026-11-02', 'témoin');
  assert.deepEqual(diamant(t.ctx), ['2026-11-02'], 'témoin');
  // Semaine choisie (19/10), puis lundi 2/11
  const { ctx, maintenant } = await ouvrir();
  await ctx.selectWeek('2026-10-19', null);
  maintenant.setTime(new Date('2026-11-02T09:00:00+01:00').getTime());
  await ctx.loadCurrencyReport();
  assert.equal(lire(ctx, 'S')._rptSemaine, '2026-10-19', 'la semaine choisie reste (voulu)');
  const atteignable = diamant(ctx).includes('2026-11-02') || moisProposes(ctx).includes('2026-11');
  assert.ok(atteignable, '◆ affiché sur ' + JSON.stringify(diamant(ctx)) + ', novembre proposé : ' + moisProposes(ctx).includes('2026-11'));
});

// R6 (contrôle, doit PASSER) — lundiDe / semaine courante autour des changements d'heure.
test('R6 (contrôle) : lundi de la semaine autour des changements d heure (Paris)', () => {
  const ctx = H.charger({ muet: true });
  const cas = { '2026-10-25': '2026-10-19', '2026-10-26': '2026-10-26', '2026-11-01': '2026-10-26', '2027-03-28': '2027-03-22', '2027-03-29': '2027-03-29', '2026-03-29': '2026-03-23' };
  for (const [j, l] of Object.entries(cas)) assert.equal(ctx.lundiDe(j), l, j);
  for (const [inst, lundi] of [['2026-10-25T02:30:00+01:00', '2026-10-19'], ['2026-10-25T23:30:00+01:00', '2026-10-19'], ['2027-03-28T03:30:00+02:00', '2027-03-22'], ['2026-10-26T00:10:00+01:00', '2026-10-26']]) {
    const c = H.charger({ maintenant: new Date(inst), muet: true });
    c.initCurrencyWeek();
    assert.equal(c.__el('rpt-week').value, lundi, inst);
  }
});
