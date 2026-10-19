'use strict';
// v=5 — Démarrage rapide (UX-12/13/15/16). Chaque garde APPELLE le code et porte
// un témoin positif : vagues de requêtes, écran d'attente, Chart.js à la demande,
// liens signés groupés, script de tête d'index.html.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { charger, lire, faireDb, ChartFactice, horsContexte, RACINE, SOURCE_HTML } = require('./charger-app.js');

const tour = () => new Promise((r) => setImmediate(r));
async function laisserFiler(n = 8) { for (let i = 0; i < n; i++) await tour(); }

// Base « à guichet » : chaque requête reste en vol jusqu'à ce que le test la
// serve. Une VAGUE = les requêtes en vol en même temps (elles ne s'attendent pas).
function baseAGuichet() {
  const enAttente = [];
  const reponses = new Proxy({}, {
    get: (_, nom) => (etat) => new Promise((ok) => enAttente.push({ nom: String(nom), etat, ok })),
  });
  const db = faireDb({ reponses });
  db.enAttente = enAttente;
  return db;
}
async function servirVagues(db, repondre, max = 12) {
  const vagues = [];
  for (let i = 0; i < max; i++) {
    await laisserFiler();
    if (!db.enAttente.length) break;
    const lot = db.enAttente.splice(0);
    vagues.push(lot.map((q) => q.nom).sort());
    lot.forEach((q) => q.ok(repondre(q.nom, q.etat)));
  }
  return vagues;
}
// Réponses d'un compte membre ordinaire (préférences déjà migrées).
function repondreDemarrage(nom, etat) {
  const filtre = (c) => (etat.filtres.find((f) => f[1] === c) || [])[2];
  const espace = { id: 'ws-a', name: 'Espace Fictif', is_shared: false };
  switch (nom) {
    case 'allowed_emails': return { data: { workspace_id: 'ws-a' }, error: null };
    case 'workspaces': return { data: filtre('id') ? espace : [espace], error: null };
    case 'user_preferences': return { data: { theme: 'dark', extra: { migrated_v8: true } }, error: null };
    case 'users': return { data: filtre('auth_user_id') ? { id: 'u1', name: 'Trader Fictif', color: '#4da6ff' } : [], error: null };
    default: return { data: [], error: null };
  }
}
const MEMBRE = { id: 'auth-1', email: 'trader@exemple.fr', app_metadata: { role: 'member' } };
const classes = (ctx) => ctx.document.documentElement.classList;

test('démarrage : 3 vagues de données (avant : 7), sans le rapport de la semaine', async () => {
  const db = baseAGuichet();
  db.auth.getUser = async () => ({ data: { user: MEMBRE }, error: null });
  const ctx = charger({ db, muet: true });
  await laisserFiler(); // bootAuth : pas de session mémorisée
  const fin = ctx.postLogin();
  const vagues = await servirVagues(db, repondreDemarrage);
  await fin;
  assert.equal(lire(ctx, 'S.appReady'), true, 'témoin : l app est prête');
  assert.deepEqual(horsContexte(vagues), [
    ['allowed_emails', 'user_preferences', 'user_preferences'], // workspace, thème, migration
    ['workspaces'], // détail du workspace (dépend du 1er)
    ['accounts', 'trades', 'users', 'users'], // traders, comptes, trades, profil
  ]);
  assert.ok(!vagues.flat().includes('currency_reports'), 'le rapport se charge à l ouverture de l onglet Rapports');
});

test('session mémorisée : écran d attente pendant le chargement, retiré une fois l app prête', async () => {
  const db = baseAGuichet();
  db.auth.getSession = async () => ({ data: { session: { user: MEMBRE } }, error: null });
  db.auth.getUser = async () => ({ data: { user: MEMBRE }, error: null });
  const ctx = charger({ db, muet: true });
  classes(ctx).add('demarrage'); // posé par la tête d'index.html avant app.js
  await laisserFiler();
  assert.ok(db.enAttente.length > 0, 'témoin : des requêtes sont en vol');
  assert.ok(classes(ctx).contains('demarrage'), 'toujours « Chargement de ton espace… » pendant la 1re vague');
  await servirVagues(db, repondreDemarrage);
  await laisserFiler();
  assert.ok(ctx.__el('app-wrap').classList.contains('ready'), 'témoin : l app est affichée');
  assert.ok(!classes(ctx).contains('demarrage'), 'écran d attente retiré');
});

test('sans session : le formulaire reprend la place de l écran d attente', async () => {
  const ctx = charger({ muet: true });
  classes(ctx).add('demarrage');
  assert.ok(classes(ctx).contains('demarrage'), 'témoin');
  await laisserFiler();
  assert.ok(!classes(ctx).contains('demarrage'));
});

test('échec au démarrage : retour au formulaire, jamais d écran figé', async () => {
  const db = faireDb();
  db.auth.getSession = async () => ({ data: { session: { user: MEMBRE } }, error: null });
  db.auth.getUser = async () => { throw new Error('réseau coupé'); };
  const ctx = charger({ db, muet: true });
  classes(ctx).add('demarrage');
  await laisserFiler();
  assert.ok(!ctx.__el('app-wrap').classList.contains('ready'), 'témoin : l app n a pas démarré');
  assert.ok(!classes(ctx).contains('demarrage'), 'le formulaire est rendu');
  assert.ok(ctx.__console.some((l) => l[0] === 'error'), 'l échec est journalisé');
});

test('aucun espace attribué : l écran d attente laisse place au message', async () => {
  const db = faireDb({ reponses: { allowed_emails: { data: null, error: null } } });
  db.auth.getUser = async () => ({ data: { user: MEMBRE }, error: null });
  const ctx = charger({ db, muet: true, minuteriesImmediates: true });
  await laisserFiler();
  classes(ctx).add('demarrage');
  await ctx.postLogin();
  assert.match(ctx.__el('login-msg').textContent, /Aucun workspace assigné/, 'témoin : le message est écrit');
  assert.ok(!classes(ctx).contains('demarrage'), 'et visible (formulaire rendu)');
});

// ─── Chart.js à la demande ───
const EMPREINTES = JSON.parse(fs.readFileSync(path.join(RACINE, 'vendor/empreintes.json'), 'utf8'));
const scripts = (ctx) => ctx.document.head.children.filter((s) => s.tagName === 'SCRIPT');

test('Chart.js à la demande : un seul <script>, avec son empreinte SRI', async () => {
  const ctx = charger({ sansChart: true });
  const p1 = ctx.chargerBiblio('chart');
  const p2 = ctx.chargerBiblio('chart');
  assert.equal(scripts(ctx).length, 1, 'un seul téléchargement, même demandé deux fois');
  const s = scripts(ctx)[0];
  assert.equal(s.src, 'vendor/chartjs-4.4.1/chart.umd.js');
  assert.equal(s.integrity, EMPREINTES['vendor/chartjs-4.4.1/chart.umd.js'], 'fichier modifié = refusé');
  ctx.Chart = ChartFactice; s.onload(); // arrivée du fichier
  await p1; await p2;
  await ctx.chargerBiblio('chart');
  assert.equal(scripts(ctx).length, 1, 'déjà là : aucun nouveau téléchargement');
});

test('Chart.js : un échec est signalé et autorise un nouvel essai', async () => {
  const ctx = charger({ sansChart: true });
  const p = ctx.chargerBiblio('chart');
  scripts(ctx)[0].onerror();
  await assert.rejects(p);
  ctx.chargerBiblio('chart').catch(() => {});
  assert.equal(scripts(ctx).length, 2, 'nouvel essai possible');
  await assert.rejects(ctx.chargerBiblio('inconnue'));
});

test('graphiques du tableau de bord : dessinés dès que Chart.js arrive, une seule fois', async () => {
  const ctx = charger({ sansChart: true });
  lire(ctx, 'S').trades = [
    { id: 'a', status: 'closed', actual_rr: 2, trade_date: '2026-10-02', instrument: 'EURUSD' },
    { id: 'b', status: 'closed', actual_rr: -1, trade_date: '2026-10-05', instrument: 'GBPUSD' },
  ];
  const avant = ChartFactice.instances.length;
  ctx.renderCharts(); ctx.renderCharts(); // demandés deux fois avant l'arrivée
  assert.equal(ChartFactice.instances.length, avant, 'rien sans Chart.js (et pas d erreur)');
  ctx.Chart = ChartFactice; scripts(ctx)[0].onload();
  await laisserFiler();
  const nouveaux = ChartFactice.instances.slice(avant).map((c) => c.config.type).sort();
  assert.deepEqual(nouveaux, ['bar', 'line'], 'courbe + barres, une seule fois chacune');
});

test('section Macro : le graphique attend Chart.js puis se dessine', async () => {
  const ctx = charger({ sansChart: true });
  const avant = ChartFactice.instances.length;
  ctx.loadMacro();
  assert.equal(ChartFactice.instances.length, avant, 'témoin : rien avant l arrivée');
  ctx.Chart = ChartFactice; scripts(ctx)[0].onload();
  await laisserFiler();
  assert.equal(ChartFactice.instances.length, avant + 1);
});

// ─── Liens signés groupés (UX-15) ───
test('fiche trade : toutes les captures signées en UNE requête (avant : une par image)', async () => {
  const db = faireDb();
  const ctx = charger({ db });
  lire(ctx, 'S').existingImgs = [
    { storage_path: 'trades/t1/entry/a.png', image_type: 'entry', mime_type: 'image/png' },
    { storage_path: 'trades/t1/close/b.png', image_type: 'close', mime_type: 'image/png' },
    { storage_path: 'trades/t1/file/c.png', image_type: 'file', mime_type: 'image/png' },
    { storage_path: 'trades/t1/entry/refuse.png', image_type: 'entry', mime_type: 'image/png' },
  ];
  await ctx.renderExistingImgs();
  assert.equal(db.signatures.length, 1, 'une seule requête');
  assert.equal(db.signatures[0].length, 4);
  assert.equal(db.unitaires.length, 0);
  assert.match(ctx.__el('prev-entry').innerHTML, /signe\/trades\/t1\/entry\/a\.png/, 'témoin : la vignette est rendue');
  assert.doesNotMatch(ctx.__el('prev-entry').innerHTML, /refuse/, 'un fichier sans droit est simplement absent');
  assert.match(ctx.__el('prev-close').innerHTML, /b\.png/);
  assert.match(ctx.__el('prev-file').innerHTML, /c\.png/);
});

test('journal : les vignettes d un trade signées en UNE requête', async () => {
  const db = faireDb({ reponses: { trade_images: { data: [
    { storage_path: 'trades/t1/entry/a.png', image_type: 'entry', mime_type: 'image/png' },
    { storage_path: 'trades/t1/close/b.png', image_type: 'close', mime_type: 'image/png' },
    { storage_path: 'trades/t1/file/releve.pdf', image_type: 'file', mime_type: 'application/pdf', filename: 'releve.pdf' },
  ], error: null } } });
  const ctx = charger({ db });
  ['ig-entry-t1', 'ig-close-t1', 'ig-file-t1', 'fl-t1'].forEach((id) => ctx.__creer(id));
  await ctx.loadImagesInView('t1');
  assert.equal(db.signatures.length, 1);
  assert.deepEqual(horsContexte(db.signatures[0]), ['trades/t1/entry/a.png', 'trades/t1/close/b.png']);
  assert.match(ctx.__el('ig-entry-t1').innerHTML, /a\.png/, 'témoin : vignette rendue');
  assert.match(ctx.__el('ig-close-t1').innerHTML, /b\.png/);
  assert.match(ctx.__el('fl-t1').innerHTML, /releve\.pdf/, 'le PDF reste listé (non signé)');
});

test('panneau de détail : captures signées en UNE requête', async () => {
  const db = faireDb({ reponses: { trade_images: { data: [
    { storage_path: 'trades/t1/entry/a.png', image_type: 'entry', filename: 'a.png' },
    { storage_path: 'trades/t1/close/b.png', image_type: 'close', filename: 'b.png' },
  ], error: null } } });
  const ctx = charger({ db });
  lire(ctx, 'S').trades = [{ id: 't1', instrument: 'EURUSD', direction: 'LONG', status: 'closed', actual_rr: 1, trade_date: '2026-10-02' }];
  ctx.__creer('tjp-imgs-single');
  await ctx.showTradeDetailById('t1');
  assert.equal(db.signatures.length, 1);
  assert.equal(db.unitaires.length, 0);
  const html = ctx.__el('tjp-imgs-single').innerHTML;
  assert.match(html, /entry/); assert.match(html, /signe\/trades\/t1\/close\/b\.png/);
});

test('rapports : les captures de la semaine signées en UNE requête (la plus récente par zone)', async () => {
  const db = faireDb({ reponses: { currency_reports: { data: { id: 'cr1', currency_report_entries: [
    { id: 'e1', currency: 'USD', bias: 'bullish', notes: 'Fed', currency_report_images: [
      { image_type: 'pm', storage_path: 'currency/cr1/USD/pm_2.png', created_at: '2026-10-12T10:00:00Z' },
      { image_type: 'pm', storage_path: 'currency/cr1/USD/pm_1.png', created_at: '2026-10-11T10:00:00Z' },
      { image_type: 'gh', storage_path: 'currency/cr1/USD/gh_1.png', created_at: '2026-10-12T10:00:00Z' },
    ] },
    { id: 'e2', currency: 'EUR', bias: null, notes: '', currency_report_images: [
      { image_type: 'pm', storage_path: 'currency/cr1/EUR/pm_1.png', created_at: '2026-10-12T10:00:00Z' },
    ] },
  ] }, error: null } } });
  const ctx = charger({ db });
  ctx.__el('rpt-week').value = '2026-10-12';
  await ctx.loadCurrencyReport();
  assert.deepEqual(horsContexte(db.signatures), [['currency/cr1/USD/pm_2.png', 'currency/cr1/USD/gh_1.png', 'currency/cr1/EUR/pm_1.png']]);
  assert.equal(db.unitaires.length, 0);
  const cache = horsContexte(ctx._curImgCache);
  assert.equal(cache['pm-USD'].url, 'https://exemple.invalid/signe/currency/cr1/USD/pm_2.png', 'témoin : lien en cache');
  assert.equal(cache['gh-USD'].path, 'currency/cr1/USD/gh_1.png');
  assert.ok(cache['pm-EUR']);
});

// ─── Script de tête d'index.html (écran d'attente avant le premier affichage) ───
function scriptDeTete() {
  const m = /<head>[\s\S]*?<script>([\s\S]*?)<\/script>/.exec(SOURCE_HTML);
  assert.ok(m, 'témoin : le script de tête existe');
  return m[1];
}
function jouerTete({ jeton = null, hash = '', stockageBloque = false } = {}) {
  const cle = 'sb-' + new URL(lire(charger(), 'SB_URL')).hostname.split('.')[0] + '-auth-token';
  const poses = new Set();
  vm.runInNewContext(scriptDeTete(), {
    localStorage: { getItem: (k) => { if (stockageBloque) throw new Error('bloqué'); return k === cle ? jeton : null; } },
    location: { hash },
    document: { documentElement: { classList: { add: (c) => poses.add(c) } } },
  });
  return poses.has('demarrage');
}

test('tête d index.html : écran d attente seulement si une session est mémorisée', () => {
  assert.equal(jouerTete({ jeton: '{"access_token":"x"}' }), true, 'session mémorisée (clé de supabase-js pour SB_URL)');
  assert.equal(jouerTete(), false, 'pas de session : formulaire');
  assert.equal(jouerTete({ jeton: 'x', hash: '#access_token=a&type=recovery' }), false, 'mot de passe oublié : formulaire');
  assert.equal(jouerTete({ hash: '#access_token=a&type=signup' }), true, 'retour d un lien de connexion');
  assert.equal(jouerTete({ stockageBloque: true }), false, 'stockage bloqué : pas d erreur, formulaire');
});
