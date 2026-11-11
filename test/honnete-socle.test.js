'use strict';
// v=6 — Données honnêtes, socle commun : lecture des nombres, résultat saisi, ordre
// de saisie, rechargement qui garde le mois et les filtres, Macro datée, message de
// connexion conservé au rechargement, tuile « durée » retirée. Chaque garde APPELLE
// le code et porte un témoin positif.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire, injecter, faireDb, horsContexte } = require('./charger-app.js');

const tour = () => new Promise((r) => setImmediate(r));
async function laisserFiler(n = 8) { for (let i = 0; i < n; i++) await tour(); }

test('lireDecimal : virgule ou point décimal, vide = non renseigné, le reste refusé', () => {
  const { lireDecimal } = charger();
  assert.equal(lireDecimal('1,5'), 1.5);
  assert.equal(lireDecimal('-0,75'), -0.75);
  assert.equal(lireDecimal('2.25'), 2.25);
  assert.equal(lireDecimal('0'), 0, 'un 0 saisi est un 0 (BE), pas une absence');
  assert.equal(lireDecimal(''), null);
  assert.equal(lireDecimal('  '), null);
  for (const illisible of ['1 000', '1,2,3', '1.2.3', 'abc', '1,5R', '--1']) {
    assert.ok(Number.isNaN(lireDecimal(illisible)), 'refusé : ' + illisible);
  }
});

test('résultat et P&L saisis : 0 compte, null ou vide non ; trades comptés sans annulés ni tests', () => {
  const ctx = charger();
  assert.equal(ctx.aResultat({ actual_rr: 0 }), true);
  assert.equal(ctx.aResultat({ actual_rr: '0' }), true);
  assert.equal(ctx.aResultat({ actual_rr: null }), false);
  assert.equal(ctx.aResultat({}), false);
  assert.equal(ctx.aPnl({ pnl_amount: 0 }), true);
  assert.equal(ctx.aPnl({ pnl_amount: null }), false);
  const comptes = ctx.tradesComptes([{ id: 'r', status: 'closed' }, { id: 'a', status: 'cancelled' }, { id: 't', status: 'closed', is_test: true }]);
  assert.deepEqual(horsContexte(comptes.map((t) => t.id)), ['r']);
});

test('ordre chronologique : à date égale, l ordre de saisie', () => {
  const ctx = charger();
  const trades = [
    { id: 'b', trade_date: '2026-10-02', created_at: '2026-10-02T15:00:00Z' },
    { id: 'a', trade_date: '2026-10-02', created_at: '2026-10-02T09:00:00Z' },
    { id: 'c', trade_date: '2026-10-01', created_at: '2026-10-03T09:00:00Z' },
  ];
  assert.deepEqual(trades.slice().sort(ctx.ordreChrono).map((t) => t.id), ['c', 'a', 'b']);
});

test('après une écriture : le mois choisi et les filtres du journal restent appliqués', async () => {
  const trades = [
    { id: 'sept', instrument: 'EURUSD', direction: 'LONG', status: 'closed', actual_rr: 2, trade_date: '2026-09-10', created_at: '2026-09-10T09:00:00Z' },
    { id: 'oct', instrument: 'GBPUSD', direction: 'SHORT', status: 'closed', actual_rr: -1, trade_date: '2026-10-02', created_at: '2026-10-02T09:00:00Z' },
    { id: 'oct2', instrument: 'XAUUSD', direction: 'LONG', status: 'closed', actual_rr: 1, trade_date: '2026-10-05', created_at: '2026-10-05T09:00:00Z' },
  ];
  const ctx = charger({ db: faireDb({ reponses: { trades: { data: trades, error: null } } }), maintenant: new Date('2026-10-20T10:00:00+02:00') });
  injecter(ctx, { S_dashMonths: new Set(['2026-9']) }); // octobre (mois 0-11)
  ctx.__el('f-dir').value = 'SHORT';
  await ctx.rechargerTrades();
  assert.match(ctx.__el('stats-row').innerHTML, /OCTOBRE 2026/, 'le mois choisi reste appliqué (pas « ALL TIME »)');
  assert.deepEqual(horsContexte(lire(ctx, 'S').filtered.map((t) => t.id)), ['oct'], 'le filtre « SHORT » du journal reste appliqué');
});

test('Macro : relevé ancien signalé, « Dernière valeur saisie », source citée seulement avec des chiffres', () => {
  const ctx = charger({ maintenant: new Date('2026-10-20T10:00:00+02:00') });
  assert.equal(ctx.ageReleveMacro(new Date(2026, 9, 20)), 4, '24/05 → 20/10 : 4 mois entiers');
  assert.equal(ctx.ageReleveMacro(new Date(2026, 5, 23)), 0);
  assert.equal(ctx.ageReleveMacro(new Date(2026, 5, 24)), 1);
  ctx.loadMacro();
  const bandeau = ctx.__el('macro-fraicheur');
  assert.equal(bandeau.hidden, false, 'bandeau visible');
  assert.match(bandeau.textContent, /24\/05\/2026/);
  assert.match(bandeau.textContent, /il y a 4 mois/);
  assert.match(bandeau.textContent, /ne se mettent pas à jour tout seuls/);
  assert.match(ctx.__el('macro-indic-latest').textContent, /^Dernière valeur saisie/, 'témoin : une série affichée');
  assert.match(ctx.__el('macro-indic-source').textContent, /relevé du 24\/05\/2026/);
});

test('Macro : un indicateur sans donnée le dit, sans renvoyer vers Claude ni citer de source', () => {
  const ctx = charger({ maintenant: new Date('2026-10-20T10:00:00+02:00') });
  const tabs = lire(ctx, 'MACRO_TABS'); const zones = lire(ctx, 'MACRO_ZONES'); const data = lire(ctx, 'MACRO_DATA');
  let vide = null;
  for (const z of zones) for (const t of tabs) for (const s of t.subs) {
    const serie = ((data[z.code] || {})[t.key] || {})[s.key];
    if (!vide && !(Array.isArray(serie) && serie.length)) vide = { z: z.code, t: t.key, s: s.key };
  }
  assert.ok(vide, 'témoin : une combinaison zone / indicateur sans donnée existe');
  injecter(ctx, { S_macroZone: vide.z, S_macroTab: vide.t, S_macroSub: vide.s });
  ctx.renderMacroChart();
  const err = ctx.__el('macro-error').innerHTML;
  assert.match(err, /Pas de donnée pour/);
  assert.match(err, /relevé du 24\/05\/2026/);
  assert.doesNotMatch(err, /Claude/);
  assert.equal(ctx.__el('macro-indic-source').textContent, '', 'pas de source citée sans chiffres');
});

test('« aucun espace » : erreur lisible dans le formulaire visible, conservée au rechargement, une seule fois', async () => {
  const db = faireDb({ reponses: { allowed_emails: { data: null, error: null } } });
  db.auth.getUser = async () => ({ data: { user: { id: 'auth-1', email: 'sans-espace@exemple.fr', app_metadata: {} } }, error: null });
  const ctx = charger({ db, muet: true, minuteriesImmediates: true });
  await laisserFiler();
  await ctx.postLogin(); // chemin du formulaire : la déconnexion qui suit recharge la page
  const msg = ctx.__el('login-msg');
  assert.match(msg.className, /\berror\b/, 'classe d erreur stylée (avant : « err », sans style)');
  assert.match(msg.textContent, /Aucun espace n'est attribué à ton compte/);
  const apres = charger({ muet: true, session: ctx.sessionStorage }); // rechargement
  await laisserFiler();
  assert.match(apres.__el('login-msg').textContent, /Aucun espace n'est attribué/, 'message conservé après rechargement');
  assert.match(apres.__el('login-msg').className, /\berror\b/);
  const encore = charger({ muet: true, session: ctx.sessionStorage });
  await laisserFiler();
  assert.equal(encore.__el('login-msg').textContent, '', 'affiché une fois, puis oublié');
});

test('tableau de bord : plus de tuile « DURÉE MOY. / TRADE » (elle comptait des trades)', () => {
  const ctx = charger();
  lire(ctx, 'S').trades = [{ id: 'a', status: 'closed', actual_rr: 1, trade_date: '2026-10-02', created_at: '2026-10-02T09:00:00Z' }];
  ctx.renderStats();
  const html = ctx.__el('stats-row').innerHTML;
  assert.match(html, /TRADE WIN %/, 'témoin : le panneau est rendu');
  assert.doesNotMatch(html, /DURÉE MOY/);
});

// ─── Retouches d'intégration v=6 (entre deux zones) ───
test('fiche : lecture des captures en échec dite dans l onglet (pas un onglet vide)', async () => {
  const db = faireDb({ reponses: { trade_images: { data: null, error: { message: 'refus' } } } });
  const ctx = charger({ db, muet: true });
  lire(ctx, 'S').trades = [{ id: 't1', instrument: 'EURUSD', direction: 'LONG', status: 'closed', actual_rr: 1, trade_date: '2026-10-02', created_at: '2026-10-02T09:00:00Z' }];
  await ctx.openTrade('t1');
  assert.match(ctx.__el('prev-entry').innerHTML, /indisponibles/, 'l échec de lecture est dit');
  const ok = charger({ db: faireDb({ reponses: { trade_images: { data: [], error: null } } }), muet: true });
  lire(ok, 'S').trades = lire(ctx, 'S').trades;
  await ok.openTrade('t1');
  assert.doesNotMatch(ok.__el('prev-entry').innerHTML, /indisponibles/, 'témoin : aucune capture n est pas un échec');
});

test('info-bulles des graphiques : un trade sans date dit « date non saisie », pas sa date de saisie', () => {
  const ctx = charger();
  const t = { id: 'x', instrument: 'EURUSD', status: 'closed', actual_rr: 1, trade_date: null, created_at: '2026-10-02T09:00:00Z' };
  const avec = { ...t, id: 'y', trade_date: '2026-10-05' };
  ctx.makeRRChart([t, avec]);
  const titre = lire(ctx, 'S').chartRR.config.options.plugins.tooltip.callbacks.title;
  assert.match(titre([{ dataIndex: 0, label: '' }]), /date non saisie · saisi le 02\/10\/26/);
  assert.match(titre([{ dataIndex: 1, label: '' }]), /EURUSD · 05\/10\/26/, 'témoin : date du trade quand elle existe');
});

test('styles : un texte indicatif ne se lit pas comme une valeur (gris, italique)', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(css, /\.f-inp::placeholder,textarea::placeholder\{[^}]*font-style:italic/);
});
