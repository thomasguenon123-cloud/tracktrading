'use strict';
// v=6 « données honnêtes » — connexion, chargement de l'espace, toasts, données
// test et Admin (constats 3, 65-74). Chaque garde APPELLE le code et porte un
// témoin positif : un échec ne doit jamais s'afficher comme un vide ou un succès.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire, faireDb, horsContexte, ChartFactice } = require('./charger-app.js');

const tour = () => new Promise((r) => setImmediate(r));
async function laisserFiler(n = 8) { for (let i = 0; i < n; i++) await tour(); }

// ─── Constat 73 : messages de connexion en français ───
test('connexion : une panne réseau est dite en français (Chrome, Safari, Firefox, status 0)', () => {
  const ctx = charger({ muet: true });
  const t = (e) => ctx.translateAuthError(e);
  assert.equal(t({ message: 'Invalid login credentials', status: 400 }), 'Email ou mot de passe incorrect.', 'témoin : message connu inchangé');
  const reseau = /^Problème de connexion réseau/;
  assert.match(t({ message: 'Failed to fetch', status: 0 }), reseau);
  assert.match(t(new Error('Load failed')), reseau, 'Safari, sans status');
  assert.match(t(new Error('Failed to fetch')), reseau, 'Chrome, sans status');
  assert.match(t({ message: 'NetworkError when attempting to fetch resource.' }), reseau, 'Firefox');
  assert.match(t({ message: 'quelconque', status: 0 }), reseau, 'status 0 = fetch rejeté');
});

test('connexion : erreur de base à l inscription et message inconnu, sans texte brut à l écran', () => {
  const ctx = charger({ muet: true });
  const t = (e) => ctx.translateAuthError(e);
  const inscr = t({ message: 'Database error saving new user', status: 500 });
  assert.match(inscr, /^Inscription refusée par le serveur \(email non autorisé ou erreur technique\)/, 'cause probable, pas certaine');
  assert.doesNotMatch(inscr, /réseau/, 'un 500 n est pas une panne réseau');
  assert.equal(t({ message: 'Database error finding user', status: 500 }), 'Erreur inattendue, réessaie.');
  assert.ok(ctx.__console.some((l) => l[0] === 'warn' && String(l[2]?.message).includes('finding user')), 'le texte brut reste en console');
  assert.equal(t(new Error('')), 'Erreur inattendue, réessaie.', 'jamais « Error »');
});

test('connexion : formulaire hors ligne → message réseau en français', async () => {
  const db = faireDb();
  db.auth.signInWithPassword = async () => ({ data: {}, error: { message: 'Failed to fetch', status: 0, name: 'AuthRetryableFetchError' } });
  const ctx = charger({ db, muet: true });
  await laisserFiler();
  ctx.__el('login-email').value = 'trader@exemple.fr';
  ctx.__el('login-password').value = 'motdepasse-fictif';
  await ctx.doLogin();
  assert.equal(ctx.__el('login-msg').className, 'auth-msg visible error', 'témoin : message affiché');
  assert.match(ctx.__el('login-msg').textContent, /^Problème de connexion réseau/);
});

// ─── Constat 69 : toasts et messages d'erreur ───
const toastDe = (ctx) => ctx.__el('toast');
test('toast : un avertissement n est pas écrasé par le message suivant (8 s, fermeture au clic)', () => {
  const ctx = charger({ muet: true });
  const t = toastDe(ctx);
  ctx.toast('Chargement…', 'ok');
  ctx.toast('Terminé ✅', 'ok');
  assert.equal(t.textContent, 'Terminé ✅', 'témoin : un message ordinaire remplace le précédent');
  ctx.toast('⚠ Attention : espace différent', 'err');
  assert.equal(t.className, 'show err');
  ctx.toast('Étape 1 ✅', 'ok');
  ctx.toast('Étape 2 ✅', 'ok');
  assert.equal(t.textContent, '⚠ Attention : espace différent', 'l avertissement reste affiché');
  assert.equal(typeof t.onclick, 'function', 'il se ferme au clic');
  t.onclick();
  assert.equal(t.textContent, 'Étape 2 ✅', 'puis le dernier message ordinaire (le dépassé est oublié)');
  assert.equal(t.className, 'show ok');
});

test('toast : ta prochaine action lève la protection (un nouvel essai réussi remplace l erreur)', () => {
  const ctx = charger({ muet: true });
  const t = toastDe(ctx);
  ctx.toast('Capture non envoyée : réessaie', 'err');
  ctx.toast('Rapport sauvegardé ✅', 'ok'); // arrivé dans la même foulée : attend
  assert.equal(t.textContent, 'Capture non envoyée : réessaie', 'témoin : protégé avant toute action');
  ctx.actionUtilisateur({ target: {} }); // un clic ailleurs dans la page
  assert.equal(t.textContent, 'Rapport sauvegardé ✅', 'le message en attente passe');
  ctx.toast('Capture non envoyée : réessaie', 'err');
  ctx.actionUtilisateur(); // clic sur « Sauvegarder » pour réessayer
  ctx.toast('Trade sauvegardé ✅', 'ok');
  assert.equal(t.textContent, 'Trade sauvegardé ✅', 'après ton action, le résultat du nouvel essai s affiche');
  ctx.toast('Erreur C', 'err');
  t.contains = () => true;
  ctx.actionUtilisateur({ target: t }); // appui SUR le message : il se fermera par son onclick
  ctx.toast('Suite ✅', 'ok');
  assert.equal(t.textContent, 'Erreur C', 'appuyer sur le message n est pas une autre action');
});

test('toast : deux avertissements se suivent sans se perdre', () => {
  const ctx = charger({ muet: true });
  const t = toastDe(ctx);
  ctx.toast('Erreur A', 'err');
  ctx.toast('Erreur B', 'err');
  assert.equal(t.textContent, 'Erreur A', 'témoin');
  t.onclick();
  assert.equal(t.textContent, 'Erreur B');
});

test('messageErreur : codes courants en français, détail technique en console', () => {
  const ctx = charger({ muet: true });
  const m = (e) => ctx.messageErreur(e);
  assert.equal(m({ code: '23505', message: 'duplicate key value violates unique constraint' }), 'cette valeur existe déjà');
  assert.equal(m({ code: '42501', message: 'permission denied for table trades' }), 'action non autorisée pour ton compte');
  assert.equal(m({ code: '22P02', message: 'invalid input syntax for type boolean: "x"' }), 'valeur refusée par le serveur (format invalide)');
  assert.equal(m({ message: 'TypeError: Failed to fetch' }), 'problème de connexion réseau');
  assert.equal(m({ code: 'XX000', message: 'boom' }), 'erreur inattendue du serveur');
  assert.ok(ctx.__console.some((l) => l[0] === 'error' && l[1]?.message === 'permission denied for table trades'), 'témoin : l erreur brute est en console');
});

// Base qui compte les lignes écrites (Prefer count=exact) : insert/delete rendent `count`.
function baseTrades({ count = null, erreur = null, lignes = [] } = {}) {
  return faireDb({ reponses: {
    trades: (etat) => (etat.op === 'select' ? { data: lignes, error: null }
      : (erreur ? { data: null, error: erreur, count: null } : { data: null, error: null, count })),
  } });
}
const MAISON = { id: 'ws-maison', name: 'Maison', is_shared: false };
const EQUIPE = { id: 'ws-equipe', name: 'Equipe', is_shared: true };
function espace(ctx, vue = MAISON, extra = {}) {
  Object.assign(lire(ctx, 'S'), { workspaceId: MAISON.id, workspace: MAISON, currentWorkspaceId: vue.id, currentWorkspace: vue,
    availableWorkspaces: [MAISON, EQUIPE], accounts: [{ id: 'acc-' + vue.id, name: 'Compte ' + vue.name, balance: 10000, currency: 'USD' }], ...extra });
}

test('données test : succès annoncé avec le nombre compté, l espace et les dates', async () => {
  const db = baseTrades({ count: 7 });
  const ctx = charger({ db, muet: true });
  espace(ctx);
  await ctx.insertTestData();
  const ins = db.appels.filter((a) => a.table === 'trades' && a.op === 'insert');
  assert.equal(ins.length, 1, 'témoin : insertion faite dans son espace');
  assert.equal(ins[0].charge.length, 7);
  assert.equal(toastDe(ctx).textContent, '7 trade(s) test inséré(s) dans Maison (datés de 2025) ✅');
  // Nombre non communiqué par le serveur : aucun chiffre inventé.
  const ctx2 = charger({ db: baseTrades({ count: null }), muet: true });
  espace(ctx2);
  await ctx2.insertTestData();
  assert.equal(toastDe(ctx2).textContent, 'Données test insérées dans Maison (datés de 2025) ✅');
});

test('données test en vue d un autre espace : refus expliqué, rien n est inséré', async () => {
  const db = baseTrades({ count: 7 });
  const ctx = charger({ db, muet: true });
  espace(ctx, EQUIPE);
  await ctx.insertTestData();
  assert.equal(db.appels.filter((a) => a.table === 'trades').length, 0, 'aucun trade rattaché à un compte d Equipe');
  assert.equal(toastDe(ctx).className, 'show err');
  assert.match(toastDe(ctx).textContent, /^Tu consultes Equipe : reviens à ton espace \(Maison\) pour insérer des données test\.$/);
});

test('données test : un refus du serveur est dit en français, sans « ✅ »', async () => {
  const db = baseTrades({ erreur: { code: '42501', message: 'permission denied for table trades' } });
  const ctx = charger({ db, muet: true });
  espace(ctx);
  await ctx.insertTestData();
  assert.equal(db.appels.length, 1, 'témoin : l insertion a été tentée');
  assert.equal(toastDe(ctx).textContent, 'Données test non insérées : action non autorisée pour ton compte.');
  ctx.toast('Autre message ✅', 'ok');
  assert.match(toastDe(ctx).textContent, /^Données test non insérées/, 'l échec reste lisible');
});

// ─── Constat 67 : suppression des données test et de tous les trades ───
async function confirmer(ctx) {
  const cb = lire(ctx, 'S').confirmCb;
  assert.equal(typeof cb, 'function', 'une confirmation est demandée');
  await cb();
}
test('supprimer test (super-admin) : portée réelle dite, bilan compté par le serveur', async () => {
  for (const [count, attendu] of [[3, '3 trade(s) test supprimé(s)'], [0, 'Aucun trade test à supprimer'],
    [null, 'Suppression faite (nombre non communiqué par le serveur)']]) {
    const db = baseTrades({ count });
    const ctx = charger({ db, muet: true });
    espace(ctx, EQUIPE, { isSuperAdmin: true });
    await ctx.deleteTestData();
    assert.equal(ctx.__el('confirm-msg').textContent,
      'Tous les trades TEST de TOUS les espaces auxquels tu as accès seront supprimés, pas seulement ceux de Equipe.');
    await confirmer(ctx);
    const del = db.appels.filter((a) => a.op === 'delete');
    assert.equal(del.length, 1, 'témoin : la suppression est envoyée');
    assert.deepEqual(horsContexte(del[0]), { table: 'trades', op: 'delete', charge: { count: 'exact' }, filtres: [['eq', 'is_test', true]] });
    assert.equal(toastDe(ctx).textContent, attendu);
  }
});

test('supprimer test (membre d un espace partagé) : la portée nomme l espace et ses autres membres', async () => {
  const ctx = charger({ db: baseTrades({ count: 2 }), muet: true });
  Object.assign(lire(ctx, 'S'), { workspaceId: EQUIPE.id, workspace: EQUIPE, currentWorkspaceId: EQUIPE.id, currentWorkspace: EQUIPE, isSuperAdmin: false });
  await ctx.deleteTestData();
  assert.equal(ctx.__el('confirm-msg').textContent, 'Tous les trades TEST de l\'espace Equipe seront supprimés, y compris ceux des autres membres.');
  await confirmer(ctx);
  assert.equal(toastDe(ctx).textContent, '2 trade(s) test supprimé(s)');
});

test('supprimer tous les trades : « tous les trades », pas « toutes les données » ; échec dit en français', async () => {
  const db = baseTrades({ count: 12 });
  const ctx = charger({ db, muet: true });
  espace(ctx, EQUIPE, { isSuperAdmin: true });
  ctx.confirmReset();
  assert.equal(ctx.__el('confirm-title').textContent, '⚠ Supprimer tous les trades ?');
  assert.equal(ctx.__el('confirm-msg').textContent, 'Tous les trades (réels et test) de TOUS les espaces auxquels tu as accès seront supprimés, pas seulement ceux de Equipe. Comptes, soldes et rapports ne sont pas touchés. IRRÉVERSIBLE.');
  await confirmer(ctx);
  assert.deepEqual(horsContexte(db.appels.filter((a) => a.op === 'delete').map((a) => a.charge)), [{ count: 'exact' }], 'témoin : suppression comptée');
  assert.equal(toastDe(ctx).textContent, '12 trade(s) supprimé(s), tous espaces confondus');
  const ko = charger({ db: baseTrades({ erreur: { code: '23503', message: 'update or delete on table "trades" violates foreign key constraint' } }), muet: true });
  espace(ko, MAISON, { isSuperAdmin: true });
  ko.confirmReset();
  await confirmer(ko);
  assert.equal(toastDe(ko).className, 'show err');
  assert.equal(toastDe(ko).textContent, 'Trades non supprimés : élément lié à d\'autres données.');
});

// ─── Constat 3 : un échec de lecture n'est jamais un espace vide ───
const PANNE = { data: null, error: { message: 'TypeError: Failed to fetch' } };
const ADMIN = { id: 'auth-admin', email: 'admin@exemple.fr', app_metadata: { role: 'super_admin' } };
function espionToasts(ctx) {
  const vu = [];
  const vrai = ctx.toast;
  ctx.toast = (m, t = 'ok') => { vu.push(t + ' | ' + m); return vrai(m, t); };
  return vu;
}
// Base d'un super-admin (Maison, et Equipe visible) ; `pannes` : tables en échec.
function baseAdmin(pannes = {}, donnees = {}) {
  const tradeMaison = { id: 't-m', instrument: 'EURUSD', direction: 'LONG', status: 'closed', actual_rr: 1, trade_date: '2026-10-02', created_at: '2026-10-02T08:00:00Z', is_test: false };
  const rep = {
    allowed_emails: { data: { workspace_id: MAISON.id }, error: null },
    workspaces: (e) => (e.filtres.some((f) => f[1] === 'id') ? { data: MAISON, error: null } : { data: [MAISON, EQUIPE], error: null }),
    user_preferences: { data: { theme: 'dark', extra: { migrated_v8: true } }, error: null },
    users: (e) => (e.filtres.some((f) => f[1] === 'auth_user_id') ? { data: null, error: null } : { data: [{ id: 'u1', name: 'Trader Fictif' }], error: null }),
    accounts: { data: [{ id: 'acc-m', name: 'Compte Maison', balance: 10000, currency: 'USD' }], error: null },
    trades: { data: donnees.trades || [tradeMaison], error: null },
  };
  const db = faireDb({ reponses: { ...rep, ...pannes } });
  db.auth.getUser = async () => ({ data: { user: ADMIN }, error: null });
  return db;
}

test('démarrage, trades et comptes illisibles : ni « 0 trade », ni « vide », mais un échec dit (et Réessayer)', async () => {
  const ctx = charger({ db: baseAdmin({ trades: PANNE, accounts: PANNE }), muet: true });
  await laisserFiler();
  const graphes = ChartFactice.instances.length;
  const ecrits = []; // tout ce qui est écrit dans les cadres, même un instant
  for (const id of ['stats-row', 'j-list']) {
    const el = ctx.__el(id);
    let v = el.innerHTML;
    Object.defineProperty(el, 'innerHTML', { get: () => v, set: (x) => { ecrits.push(x); v = x; }, configurable: true });
  }
  await ctx.postLogin();
  await laisserFiler();
  assert.equal(lire(ctx, 'S.appReady'), true, 'l app reste utilisable');
  assert.equal(ChartFactice.instances.length, graphes, 'aucun graphique dessiné à la place des trades');
  assert.ok(ecrits.length > 0, 'témoin : les cadres sont écrits');
  assert.ok(!ecrits.some((x) => /Aucun trade|0 trade|\+0\.00/.test(x)), 'aucun rendu à zéro, même un instant');
  const stats = ctx.__el('stats-row').innerHTML;
  const journal = ctx.__el('j-list').innerHTML;
  assert.match(stats, /Trades non chargés/);
  assert.match(journal, /Trades non chargés/);
  assert.match(journal, /reessayerChargement\(\)/, 'un bouton Réessayer');
  assert.doesNotMatch(stats + journal, /Aucun trade|0 trade|\+0\.00/);
  assert.ok(ctx.__el('dash-main').classList.contains('trades-indisponibles'), 'graphiques masqués (rien à leur place)');
  const bandeau = ctx.__el('ws-context-msg').innerHTML;
  assert.match(bandeau, /Lecture impossible \(réseau ou serveur\)/);
  assert.match(bandeau, /trades non chargés/);
  assert.match(bandeau, /comptes non chargés/);
  assert.doesNotMatch(bandeau, /est vide/);
  assert.equal(ctx.__el('toast').className, 'show err');
  // Réessayer quand le réseau revient : les trades s'affichent, l'état d'échec disparaît.
  ctx.__db.from = faireDb({ reponses: { trades: { data: [{ id: 't-m', instrument: 'GBPJPY', direction: 'LONG', status: 'closed', actual_rr: 1, trade_date: '2026-10-02', is_test: false }], error: null } } }).from;
  ctx.__el('toast').onclick();
  await ctx.reessayerChargement();
  assert.match(ctx.__el('j-list').innerHTML, /GBPJPY/, 'témoin : le journal est rendu une fois lu');
  assert.ok(!ctx.__el('dash-main').classList.contains('trades-indisponibles'));
  assert.equal(ctx.__el('ws-context-banner').style.display, 'none', 'bandeau d échec retiré');
  assert.equal(ctx.__el('toast').textContent, 'Données chargées ✅');
});

test('démarrage réussi d un espace vide : le bandeau « vide » reste réservé à une lecture réussie (témoin)', async () => {
  const ctx = charger({ db: baseAdmin({ accounts: { data: [], error: null } }, { trades: [] }), muet: true });
  await laisserFiler();
  await ctx.postLogin();
  assert.match(ctx.__el('ws-context-msg').innerHTML, /Ton workspace <b>Maison<\/b> est vide/);
  assert.doesNotMatch(ctx.__el('stats-row').innerHTML + ctx.__el('j-list').innerHTML, /Trades non chargés/);
});

test('rechargement après écriture en échec : les trades affichés restent, signalés non à jour', async () => {
  const ctx = charger({ db: faireDb({ reponses: { trades: PANNE } }), muet: true });
  espace(ctx);
  const S = lire(ctx, 'S');
  S.trades = [{ id: 't1', instrument: 'EURUSD', direction: 'LONG', status: 'closed', actual_rr: 1, trade_date: '2026-10-02', is_test: false }];
  lire(ctx, "_lus.add('trades')"); // déjà lus une fois
  const vu = espionToasts(ctx);
  const ok = await ctx.rechargerTrades();
  assert.equal(ok, false, 'l échec est rendu à l appelant');
  assert.equal(lire(ctx, 'S').trades.length, 1, 'les trades déjà chargés ne sont pas écrasés');
  assert.match(ctx.__el('j-list').innerHTML, /EURUSD/, 'témoin : ils restent affichés');
  assert.match(ctx.__el('ws-context-msg').innerHTML, /trades non rafraîchis : l(&#39;|')affichage date du dernier chargement réussi/);
  assert.deepEqual(horsContexte(vu), ['err | Modification enregistrée, mais lecture impossible (réseau ou serveur) — trades non rafraîchis : l\'affichage date du dernier chargement réussi.'],
    'l écriture réussie n est pas tue, l échec de lecture est dit');
});

test('changement de vue en échec : pas de « ✅ », retour à la vue d avant sans mélange', async () => {
  for (const pannes of [{ users: PANNE, accounts: PANNE, trades: PANNE }, { users: PANNE }, { trades: PANNE }]) {
    const ctx = charger({ db: faireDb({ reponses: pannes }), muet: true });
    const trades = [{ id: 't-m', instrument: 'EURUSD', direction: 'LONG', status: 'closed', actual_rr: 1, trade_date: '2026-10-02', is_test: false }];
    espace(ctx, MAISON, { isSuperAdmin: true, trades, users: [{ id: 'u-m', name: 'Trader Maison' }] });
    lire(ctx, "['trades', 'users', 'accounts'].forEach((k) => _lus.add(k))");
    const vu = espionToasts(ctx);
    await ctx.switchCurrentWorkspace(EQUIPE.id);
    const S = lire(ctx, 'S');
    assert.equal(S.currentWorkspaceId, MAISON.id, 'on reste sur Maison (' + Object.keys(pannes) + ')');
    assert.equal(S.trades[0].id, 't-m');
    assert.equal(S.accounts[0].id, 'acc-ws-maison', 'comptes de Maison, pas d Equipe');
    assert.equal(S.users[0].name, 'Trader Maison');
    assert.deepEqual(horsContexte(vu), ['ok | Chargement de Equipe…', 'err | Impossible de charger Equipe (réseau ou serveur) : tu restes sur Maison.']);
    assert.doesNotMatch(ctx.__el('ws-name').textContent, /\(vue\)/);
    assert.equal(ctx.__el('ws-context-banner').style.display, 'none', 'Maison n est pas signalée en échec (c est Equipe qui l est)');
  }
  // Témoin : sans panne, la vue change et le succès est annoncé.
  const ctx = charger({ db: faireDb(), muet: true });
  espace(ctx, MAISON, { isSuperAdmin: true });
  const vu = espionToasts(ctx);
  await ctx.switchCurrentWorkspace(EQUIPE.id);
  assert.equal(lire(ctx, 'S').currentWorkspaceId, EQUIPE.id);
  assert.deepEqual(horsContexte(vu), ['ok | Chargement de Equipe…', 'ok | Vue : Equipe ✅']);
});

test('liste des espaces illisible : la liste connue est gardée et « Vue active » le dit', async () => {
  const ctx = charger({ db: faireDb({ reponses: { workspaces: PANNE } }), muet: true });
  espace(ctx, MAISON, { isSuperAdmin: true });
  assert.equal(await ctx.loadAvailableWorkspaces(), false);
  assert.equal(lire(ctx, 'S').availableWorkspaces.length, 2, 'Equipe n a pas disparu');
  ctx.populateAdminWorkspaceSelector();
  const html = ctx.__el('admin-ws-selector').innerHTML;
  assert.match(html, /Equipe/, 'témoin : les espaces connus restent proposés');
  assert.match(html, /<option value="" disabled>⚠ Liste des espaces indisponible \(réseau ou serveur\)/);
  const ok = charger({ db: faireDb({ reponses: { workspaces: { data: [MAISON, EQUIPE], error: null } } }), muet: true });
  espace(ok, MAISON, { isSuperAdmin: true });
  assert.equal(await ok.loadAvailableWorkspaces(), true);
  ok.populateAdminWorkspaceSelector();
  assert.doesNotMatch(ok.__el('admin-ws-selector').innerHTML, /indisponible/);
});

test('trades jamais lus puis clic sur un mois : l état « non chargés » repasse par-dessus le rendu à zéro', async () => {
  const ctx = charger({ db: baseAdmin({ trades: PANNE }), muet: true });
  await laisserFiler();
  await ctx.postLogin();
  ctx.applyDashFilter(); // clic sur un mois : rendu des stats et du journal
  assert.match(ctx.__el('stats-row').innerHTML, /Trades non chargés/);
  assert.match(ctx.__el('j-list').innerHTML, /Trades non chargés/);
  // Témoin : après une lecture réussie, le même clic rend les vraies données.
  ctx.__db.from = faireDb().from;
  await ctx.reessayerChargement();
  ctx.applyDashFilter();
  assert.match(ctx.__el('j-list').innerHTML, /Aucun trade/, 'lecture réussie et vide : « Aucun trade » est alors vrai');
});

// Intégration v=6 (constat 3) : la recherche et les filtres du Journal rendent
// aussi la liste ; trades jamais lus → jamais « Aucun trade » à la place.
test('trades jamais lus puis recherche ou filtre du Journal : « non chargés », jamais « Aucun trade »', async () => {
  const ctx = charger({ db: baseAdmin({ trades: PANNE }), muet: true });
  await laisserFiler();
  await ctx.postLogin();
  assert.match(ctx.__el('j-list').innerHTML, /Trades non chargés/, 'témoin : état « non chargés » au démarrage');
  ctx.__el('j-search').value = 'eur';
  ctx.filterJournal(); // frappe dans la recherche, ou changement d un filtre
  assert.match(ctx.__el('j-list').innerHTML, /Trades non chargés/);
  assert.doesNotMatch(ctx.__el('j-list').innerHTML, /Aucun trade/);
  // Témoin : après une lecture réussie et vide, « Aucun trade » est vrai et s affiche.
  ctx.__db.from = faireDb().from;
  await ctx.reessayerChargement();
  ctx.filterJournal();
  assert.match(ctx.__el('j-list').innerHTML, /Aucun trade/);
});

// ─── Constat 65 : panne au chargement de l'espace ≠ « aucun espace attribué » ───
const MEMBRE = { id: 'auth-1', email: 'trader@exemple.fr', app_metadata: { role: 'member' } };
async function ouvrir(reponses) {
  const db = faireDb({ reponses: { user_preferences: { data: { theme: 'dark', extra: { migrated_v8: true } }, error: null }, ...reponses } });
  db.auth.getUser = async () => ({ data: { user: MEMBRE }, error: null });
  let sorties = 0;
  db.auth.signOut = async () => { sorties++; return { error: null }; };
  const ctx = charger({ db, muet: true, minuteriesImmediates: true });
  await laisserFiler();
  await ctx.postLogin();
  return { ctx, sorties: () => sorties };
}
test('espace : une panne réseau ou serveur ne déconnecte pas et le dit', async () => {
  for (const reponses of [
    { allowed_emails: { data: null, error: { message: 'TypeError: Failed to fetch' } } },
    { allowed_emails: { data: { workspace_id: 'ws-a' }, error: null }, workspaces: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } },
  ]) {
    const { ctx, sorties } = await ouvrir(reponses);
    assert.equal(sorties(), 0, 'session gardée (' + Object.keys(reponses).join('+') + ')');
    assert.equal(ctx.__el('login-msg').textContent, 'Impossible de charger ton espace (réseau ou serveur). Ta session est gardée : recharge la page pour réessayer.');
    assert.doesNotMatch(ctx.__el('login-msg').textContent, /Failed to fetch|timeout|Aucun espace/, 'détail technique en console seulement');
    assert.ok(ctx.__console.some((l) => l[0] === 'error' && /Failed to fetch|timeout/.test(String(l[2]))), 'témoin : le détail est en console');
    assert.ok(!ctx.__el('app-wrap').classList.contains('ready'));
  }
});

test('espace : une vraie absence garde le message « aucun espace » et la déconnexion (témoin)', async () => {
  for (const reponses of [
    { allowed_emails: { data: null, error: null } },
    { allowed_emails: { data: { workspace_id: null }, error: null } },
    { allowed_emails: { data: { workspace_id: 'ws-a' }, error: null }, workspaces: { data: null, error: null } },
  ]) {
    const { ctx, sorties } = await ouvrir(reponses);
    assert.equal(sorties(), 1, 'déconnexion (' + JSON.stringify(reponses.allowed_emails.data) + ')');
    assert.match(ctx.__el('login-msg').textContent, /^Aucun espace n'est attribué à ton compte/);
  }
});

// ─── Constat 66 : échec de getUser ───
function baseSession(getUser) {
  const db = faireDb();
  db.auth.getSession = async () => ({ data: { session: { user: MEMBRE } }, error: null });
  db.auth.getUser = getUser;
  db.sorties = [];
  db.auth.signOut = async (o) => { db.sorties.push(o || {}); return { error: null }; };
  return db;
}
test('session mémorisée, serveur injoignable : message réseau, session gardée (jamais un retour muet)', async () => {
  for (const getUser of [
    async () => ({ data: { user: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } }),
    async () => ({ data: { user: null }, error: { name: 'AuthRetryableFetchError', message: 'Bad Gateway', status: 502 } }),
    async () => { throw new Error('réseau coupé'); },
  ]) {
    const db = baseSession(getUser);
    const ctx = charger({ db, muet: true });
    ctx.document.documentElement.classList.add('demarrage');
    await laisserFiler();
    assert.equal(ctx.__el('login-msg').className, 'auth-msg visible error', 'témoin : un message est affiché');
    assert.equal(ctx.__el('login-msg').textContent, 'Connexion au serveur impossible. Vérifie ta connexion et réessaie.');
    assert.equal(db.sorties.length, 0, 'session gardée : elle redeviendra utilisable');
    assert.ok(!ctx.document.documentElement.classList.contains('demarrage'), 'formulaire rendu');
    assert.ok(ctx.__console.some((l) => l[0] === 'error'), 'détail en console');
  }
});

test('session refusée par le serveur : « plus valide », oubliée sur cet appareil, message gardé au rechargement', async () => {
  const db = baseSession(async () => ({ data: { user: null }, error: { name: 'AuthApiError', message: 'invalid JWT', status: 401, code: 'bad_jwt' } }));
  db.auth.getSession = async () => ({ data: { session: null }, error: null });
  const ctx = charger({ db, muet: true });
  await laisserFiler();
  await ctx.postLogin(); // chemin du formulaire : la déconnexion recharge la page
  assert.equal(ctx.__el('login-msg').textContent, 'Ta session n\'est plus valide. Reconnecte-toi.');
  assert.deepEqual(horsContexte(db.sorties), [{ scope: 'local' }]);
  assert.equal(ctx.sessionStorage.getItem('tt_msg_connexion'), 'Ta session n\'est plus valide. Reconnecte-toi.', 'relu après le rechargement');
});

test('connexion par le formulaire puis getUser en échec : plus de « Connexion… » figé', async () => {
  const db = faireDb();
  db.auth.getUser = async () => ({ data: { user: null }, error: { message: 'Failed to fetch', status: 0 } });
  const ctx = charger({ db, muet: true });
  await laisserFiler();
  ctx.__el('login-email').value = 'trader@exemple.fr';
  ctx.__el('login-password').value = 'motdepasse-fictif';
  await ctx.doLogin();
  assert.equal(ctx.__el('login-msg').textContent, 'Connexion au serveur impossible. Vérifie ta connexion et réessaie.');
});

// ─── Constat 74 : session fermée ailleurs ───
// Faux client qui, comme supabase-js (et le banc), émet SIGNED_OUT pendant signOut().
function baseEvenements() {
  const db = faireDb();
  db.ecouteurs = [];
  db.auth.onAuthStateChange = (f) => { db.ecouteurs.push(f); return { data: { subscription: { unsubscribe() {} } } }; };
  db.auth.signOut = async () => { db.ecouteurs.forEach((f) => f('SIGNED_OUT', null)); return { error: null }; };
  db.emettre = (evt) => db.ecouteurs.forEach((f) => f(evt, null));
  return db;
}
async function ongletConnecte(db, options = {}) {
  const ctx = charger({ db, muet: true, ...options });
  await laisserFiler();
  assert.equal(db.ecouteurs.length, 1, 'témoin : bootAuth écoute les événements de session');
  lire(ctx, 'S').authUser = { id: 'auth-1', email: 'trader@exemple.fr' };
  ctx.recharges = 0;
  ctx.location.reload = () => { ctx.recharges++; };
  return ctx;
}
test('session fermée ailleurs : rechargement expliqué au formulaire, fiche trade perdue signalée', async () => {
  const db = baseEvenements();
  const ctx = await ongletConnecte(db);
  ctx.__el('trade-modal').classList.remove('hidden'); // fiche ouverte
  db.emettre('SIGNED_OUT');
  assert.equal(ctx.recharges, 1, 'la page se recharge (comme avant)');
  const motif = 'Ta session a été fermée (déconnexion depuis un autre onglet ou session expirée). Une fiche trade était ouverte : ce qui n\'était pas enregistré est perdu. Reconnecte-toi.';
  assert.equal(ctx.sessionStorage.getItem('tt_msg_connexion'), motif);
  // La page rechargée (même sessionStorage) affiche le motif au formulaire.
  const apres = charger({ muet: true, session: ctx.sessionStorage });
  await laisserFiler();
  assert.equal(apres.__el('login-msg').textContent, motif);
  // Fiche fermée : pas de mention de la fiche.
  const ctx2 = await ongletConnecte(baseEvenements());
  ctx2.__el('trade-modal').classList.add('hidden');
  ctx2.__db.emettre('SIGNED_OUT');
  assert.equal(ctx2.sessionStorage.getItem('tt_msg_connexion'), 'Ta session a été fermée (déconnexion depuis un autre onglet ou session expirée). Reconnecte-toi.');
});

test('déconnexion volontaire (bouton, compte sans espace) : aucun motif « fermée ailleurs »', async () => {
  const db = baseEvenements();
  const ctx = await ongletConnecte(db);
  await ctx.logout();
  assert.ok(ctx.recharges >= 1, 'témoin : SIGNED_OUT reçu, la page se recharge');
  assert.equal(ctx.sessionStorage.getItem('tt_msg_connexion'), null);
  db.emettre('SIGNED_OUT'); // puis une sortie venue d'ailleurs : la marque volontaire est retombée
  assert.match(ctx.sessionStorage.getItem('tt_msg_connexion') || '', /^Ta session a été fermée/);
  // Compte sans espace par le formulaire : le message UX-22 n'est pas remplacé.
  const db2 = baseEvenements();
  db2.auth.getUser = async () => ({ data: { user: MEMBRE }, error: null });
  const ctx2 = await ongletConnecte(db2, { minuteriesImmediates: true });
  const sorties = [];
  const vrai = db2.auth.signOut;
  db2.auth.signOut = async (...a) => { sorties.push(a); return vrai(...a); }; // garde la marque volontaire
  await ctx2.postLogin();
  assert.equal(sorties.length, 1);
  assert.match(ctx2.sessionStorage.getItem('tt_msg_connexion'), /^Aucun espace n'est attribué à ton compte/);
});

// ─── Constats 70-72 : Admin (actions, statuts, compteurs) ───
const LIGNES_ADMIN = [
  { email: 'attente@exemple.fr', auth_user_id: null, workspace_name: 'Equipe', workspace_is_shared: true },
  { email: 'membre@exemple.fr', auth_user_id: '22222222-2222-4222-8222-222222222222', workspace_name: 'Maison', workspace_is_shared: false, last_sign_in_at: '2026-10-01T10:00:00Z' },
  { email: 'orphelin@exemple.fr', auth_user_id: '33333333-3333-4333-8333-333333333333', workspace_name: null },
  { email: 'chef@exemple.fr', auth_user_id: '44444444-4444-4444-8444-444444444444', is_super_admin_user: true, workspace_name: 'Maison' },
];
// Base Admin : la rpc note ses paramètres et refuse un drapeau non booléen (22P02), comme PostgREST.
function baseAdminRpc(reponses = {}) {
  const db = faireDb({ reponses: { admin_list_users: { data: LIGNES_ADMIN, error: null }, ...reponses } });
  db.rpcs = [];
  const rpc = db.rpc;
  db.rpc = (f, p) => {
    db.rpcs.push([f, p]);
    if (f === 'admin_remove_email' && typeof p.p_delete_auth !== 'boolean') {
      return Promise.resolve({ data: null, error: { code: '22P02', message: 'invalid input syntax for type boolean: "' + p.p_delete_auth + '"' } });
    }
    return rpc(f, p);
  };
  return db;
}
async function ecranAdmin(db) {
  const ctx = charger({ db, muet: true });
  espace(ctx, MAISON, { isSuperAdmin: true });
  await ctx.loadAdminUsers();
  return { ctx, lignes: ctx.__el('admin-users-tbody').children.map((tr) => tr.innerHTML) };
}

test('admin : « Annuler l invitation » sans compte, « Retirer l accès » pour un inscrit, jamais l UUID en drapeau', async () => {
  const { lignes } = await ecranAdmin(baseAdminRpc());
  assert.equal(lignes.length, 4, 'témoin : les lignes sont rendues');
  assert.match(lignes[0], /onclick="adminRemove\(&quot;attente@exemple\.fr&quot;, false\)">✕ Annuler l'invitation<\/button>/);
  assert.match(lignes[1], /onclick="adminRemove\(&quot;membre@exemple\.fr&quot;, true\)">🚫 Retirer l'accès<\/button>/);
  assert.doesNotMatch(lignes.join(''), /22222222|🗑 Retirer/, 'ni UUID dans l appel, ni libellé unique');
  assert.match(lignes[3], /Protégé/);
});

test('admin : chaque retrait est décrit tel qu il est et part avec un vrai booléen', async () => {
  const db = baseAdminRpc();
  const { ctx } = await ecranAdmin(db);
  ctx.adminRemove('attente@exemple.fr', false);
  assert.equal(ctx.__el('confirm-title').textContent, 'Annuler l\'invitation');
  assert.equal(ctx.__el('confirm-msg').textContent, 'Annuler l\'invitation de attente@exemple.fr ? Aucun compte n\'a encore été créé ; cette adresse n\'est plus autorisée à s\'inscrire.');
  await confirmer(ctx);
  assert.equal(toastDe(ctx).textContent, 'Invitation annulée : attente@exemple.fr');
  ctx.adminRemove('membre@exemple.fr', true);
  assert.equal(ctx.__el('confirm-title').textContent, 'Retirer l\'accès');
  assert.equal(ctx.__el('confirm-msg').textContent, 'Retirer l\'accès de membre@exemple.fr ? Son email est retiré de la liste blanche : la personne perd l\'accès à l\'application. Son compte n\'est pas supprimé.');
  await confirmer(ctx);
  const retraits = db.rpcs.filter((r) => r[0] === 'admin_remove_email').map((r) => r[1]);
  assert.deepEqual(horsContexte(retraits), [{ p_email: 'attente@exemple.fr', p_delete_auth: false }, { p_email: 'membre@exemple.fr', p_delete_auth: false }]);
  assert.equal(toastDe(ctx).textContent, 'Accès retiré : membre@exemple.fr', 'témoin : succès réel (pas de 22P02)');
});

test('admin : un retrait refusé est dit en français, sans succès', async () => {
  const db = baseAdminRpc({ admin_remove_email: { data: null, error: { code: '42501', message: 'permission denied for function admin_remove_email' } } });
  const { ctx } = await ecranAdmin(db);
  ctx.adminRemove('membre@exemple.fr', true);
  await confirmer(ctx);
  assert.equal(toastDe(ctx).className, 'show err');
  assert.equal(toastDe(ctx).textContent, 'Accès non retiré : action non autorisée pour ton compte.');
});

test('admin : un inscrit sans espace est « Bloqué : aucun espace », pas « Actif »', async () => {
  const { lignes } = await ecranAdmin(baseAdminRpc());
  assert.match(lignes[1], /admin-status-pill active">Actif</, 'témoin : inscrit avec espace');
  assert.match(lignes[2], /orphelin@exemple\.fr/);
  assert.match(lignes[2], /admin-status-pill bloque">Bloqué : aucun espace</);
  assert.doesNotMatch(lignes[2], />Actif</);
  assert.match(lignes[3], /admin-status-pill admin">Super Admin</, 'super admin avec espace');
  const { lignes: l2 } = await ecranAdmin(baseAdminRpc({ admin_list_users: { data: [{ email: 'chef@exemple.fr', auth_user_id: 'x', is_super_admin_user: true, workspace_name: null }], error: null } }));
  assert.match(l2[0], /Bloqué : aucun espace · super admin/, 'un super admin sans espace est bloqué lui aussi');
});

test('admin : après un retrait, compteurs et « Vue active » relus (avant : ceux de la connexion)', async () => {
  let retire = false;
  const NOUVEAU = { id: 'ws-nouveau', name: 'Nouvel Espace', is_shared: false };
  const db = baseAdminRpc({
    admin_list_workspaces: () => ({ data: [{ ...EQUIPE, member_count: retire ? 2 : 3, trade_count: 5 }], error: null }),
    workspaces: () => ({ data: retire ? [MAISON, EQUIPE, NOUVEAU] : [MAISON, EQUIPE], error: null }),
  });
  const rpc = db.rpc;
  db.rpc = (f, p) => { if (f === 'admin_remove_email') retire = true; return rpc(f, p); };
  const { ctx } = await ecranAdmin(db);
  await ctx.loadAdminWorkspaces();
  const options = () => ctx.__el('admin-workspace-select').children.map((o) => o.textContent);
  assert.ok(options().includes('Equipe · 👥 partagé · 3 membre(s) · 5 trade(s)'), 'témoin : compteurs de départ');
  ctx.adminRemove('membre@exemple.fr', true);
  await confirmer(ctx);
  assert.ok(options().includes('Equipe · 👥 partagé · 2 membre(s) · 5 trade(s)'), 'compteur relu après le retrait');
  assert.match(ctx.__el('admin-ws-selector').innerHTML, /Nouvel Espace/, '« Vue active » relue aussi');
  assert.deepEqual(horsContexte(db.rpcs.map((r) => r[0]).slice(-3).sort()), ['admin_list_users', 'admin_list_workspaces', 'admin_remove_email']);
});

test('admin : « ↻ Rafraîchir » relit tout ; compteurs illisibles dits non à jour', async () => {
  const html = require('./charger-app.js').SOURCE_HTML;
  assert.match(html, /onclick="rafraichirAdmin\(\)">↻ Rafraîchir<\/button>/);
  const db = baseAdminRpc({ admin_list_workspaces: { data: [{ ...EQUIPE, member_count: 1, trade_count: 0 }], error: null } });
  const { ctx } = await ecranAdmin(db);
  db.rpcs.length = 0;
  await ctx.rafraichirAdmin();
  assert.deepEqual(horsContexte(db.rpcs.map((r) => r[0]).sort()), ['admin_list_users', 'admin_list_workspaces'], 'témoin : liste blanche ET compteurs');
  const ko = baseAdminRpc({ admin_list_workspaces: { data: null, error: { message: 'TypeError: Failed to fetch' } } });
  const { ctx: c2 } = await ecranAdmin(ko);
  await c2.rafraichirAdmin();
  await c2.rafraichirAdmin();
  const avis = c2.__el('admin-workspace-select').children.filter((o) => o.textContent === '⚠ Compteurs non à jour (réseau ou serveur)');
  assert.equal(avis.length, 1, 'signalé une fois, pas empilé');
  assert.equal(avis[0].disabled, true);
});

test('admin : un ajout à la liste blanche relit aussi compteurs et « Vue active »', async () => {
  const db = baseAdminRpc({ admin_add_email: { data: 'id-fictif', error: null },
    workspaces: { data: [MAISON, EQUIPE, { id: 'ws-cree', name: 'Espace Cree', is_shared: false }], error: null } });
  const { ctx } = await ecranAdmin(db);
  ctx.__el('admin-new-email').value = 'nouvelle@exemple.fr';
  ctx.__el('admin-new-note').value = '';
  db.rpcs.length = 0;
  await ctx.adminAddEmail();
  assert.equal(toastDe(ctx).textContent, 'Email ajouté avec succès', 'témoin : ajout fait');
  assert.deepEqual(horsContexte(db.rpcs.map((r) => r[0]).sort()), ['admin_add_email', 'admin_list_users', 'admin_list_workspaces']);
  assert.match(ctx.__el('admin-ws-selector').innerHTML, /Espace Cree/, 'l espace créé par l ajout apparaît dans « Vue active »');
});

// ─── Constat 68 (bandeau) : en vue d'un autre espace, dire où va chaque écriture ───
test('vue d un autre espace : bandeau, infobulle et note Admin disent où vont les écritures', () => {
  const ctx = charger({ muet: true });
  espace(ctx, EQUIPE, { isSuperAdmin: true, trades: [{ id: 't1' }] });
  ctx.updateWorkspaceBanner();
  const msg = ctx.__el('ws-context-msg').innerHTML;
  assert.equal(ctx.__el('ws-context-banner').style.display, 'block', 'témoin : bandeau affiché');
  assert.match(msg, /^<b>Vue d(&#39;|')un autre espace<\/b> — Tu visualises <b style="color:var\(--blue\)">Equipe<\/b>\./);
  assert.match(msg, /Ce que tu modifies ou supprimes ici \(trades existants, rapports\) est enregistré dans cet espace\./);
  assert.match(msg, /Pour créer un trade ou des données test, reviens à ton espace \(Maison\)\./);
  assert.doesNotMatch(msg, /Mode consultation|iront dans ton workspace/);
  ctx.__creer('ws-icon'); ctx.__creer('ws-name');
  ctx.updateWorkspaceBadge();
  const bulle = ctx.__el('workspace-badge').title;
  assert.match(bulle, /Ce que tu modifies ici \(trades existants, rapports\) est enregistré dans Equipe\./);
  assert.match(bulle, /Pour créer un trade ou des données test, reviens à ton espace\./);
  const html = require('./charger-app.js').SOURCE_HTML;
  assert.match(html, /est enregistré <b>dans l'espace affiché<\/b> ;\s+pour créer un trade ou des données test, reviens à ton espace \(<span id="admin-ws-home-name">/);
  // Témoin : dans son propre espace, pas de bandeau de vue.
  const chez = charger({ muet: true });
  espace(chez, MAISON, { trades: [{ id: 't1' }] });
  chez.updateWorkspaceBanner();
  assert.equal(chez.__el('ws-context-banner').style.display, 'none');
});

// ─── Revue v=6 : un motif connu du serveur d'authentification est dit (en français) ───
test('connexion : attente imposée, même mot de passe, mot de passe faible, email invalide → motif dit, pas « Erreur inattendue »', async () => {
  const ATTENTE = { name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 52 seconds.' };
  const MEME = { name: 'AuthApiError', status: 422, code: 'same_password', message: 'New password should be different from the old password.' };
  const db = faireDb();
  db.auth.resetPasswordForEmail = async () => ({ data: {}, error: ATTENTE });
  db.auth.updateUser = async () => ({ data: {}, error: MEME });
  const ctx = charger({ db, muet: true });
  await laisserFiler();
  ctx.__el('forgot-email').value = 'trader@exemple.fr';
  await ctx.doForgot();
  ctx.__el('recovery-password').value = 'motdepasse-fictif';
  ctx.__el('recovery-password-c').value = 'motdepasse-fictif';
  await ctx.doRecovery();
  assert.equal(ctx.__el('forgot-msg').className, 'auth-msg visible error', 'témoin : un message est affiché');
  assert.equal(ctx.__el('forgot-msg').textContent, 'Trop de demandes : réessaie dans 52 secondes.');
  assert.equal(ctx.__el('recovery-msg').textContent, 'Le nouveau mot de passe doit être différent de l\'ancien.');
  assert.match(ctx.translateAuthError({ status: 422, code: 'weak_password', message: 'Password is known to be weak and easy to guess, please choose a different one.' }), /trop faible/);
  assert.equal(ctx.translateAuthError({ status: 400, code: 'email_address_invalid', message: 'Email address "x" is invalid' }), 'Adresse email invalide.');
  assert.match(ctx.translateAuthError({ status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' }), /Trop de tentatives/);
  assert.equal(ctx.translateAuthError({ status: 418, message: 'Something odd' }), 'Erreur inattendue, réessaie.', 'témoin : un cas inconnu reste générique');
});
