'use strict';
// v=6 — DONNÉES HONNÊTES, lot « saisie d'un trade » (fiche trade, clôture rapide,
// captures). Chaque garde APPELLE le code (openTrade, saveTrade, submitQuickClose…)
// sur un faux client qui note les écritures (db.appels), et porte un témoin positif.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, lire, faireDb, horsContexte, RACINE } = require('./charger-app.js');

// Base : un insert de trade rend un id ; une lecture des trades rend `liste` (rechargée
// après chaque écriture, comme en vrai) ; le reste rend des listes vides.
function baseTrades(extra = {}, liste = []) {
  return faireDb({ reponses: {
    trades: (etat) => (etat.op === 'insert' ? { data: { id: 't-nouveau' }, error: null } : { data: liste, error: null }),
    ...extra,
  } });
}
function ecritures(db, table = 'trades') { return horsContexte(db.appels.filter((a) => a.table === table)); }
function remplir(ctx, valeurs) { for (const [id, v] of Object.entries(valeurs)) ctx.__el(id).value = v; }
// Champs obligatoires d'un nouveau trade (instrument, compte, trader).
const MINIMUM = { 'm-instr': 'eurusd', 'm-acc': 'acc-1', 'm-user': 'u-1' };

function tradeFictif(extra = {}) {
  return {
    id: 't0', status: 'closed', direction: 'LONG', instrument: 'USDJPY', trade_date: '2026-07-02',
    created_at: '2026-07-02T08:00:00Z', account_id: 'acc-1', user_id: 'u-1', ...extra,
  };
}

// ─── Constat 1 : un 0 saisi (break-even) reste 0 ───
test('fiche : un R et un P&L saisis « 0 » partent 0 (pas NULL)', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  await ctx.openTrade();
  remplir(ctx, { ...MINIMUM, 'm-arr': '0', 'm-pnl': '0' });
  await ctx.saveTrade();
  const [ins] = ecritures(db);
  assert.equal(ins.op, 'insert', 'témoin : le trade est bien inséré');
  assert.equal(ins.charge.actual_rr, 0);
  assert.equal(ins.charge.pnl_amount, 0);
});

test('fiche : un R saisi 1,5 part 1.5 ; un champ vide part NULL', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  await ctx.openTrade();
  remplir(ctx, { ...MINIMUM, 'm-arr': '1,5', 'm-pnl': '' });
  await ctx.saveTrade();
  const [ins] = ecritures(db);
  assert.equal(ins.charge.actual_rr, 1.5);
  assert.equal(ins.charge.pnl_amount, null);
});

test('clôture rapide : un R de 0 sans prix de sortie clôt le trade à 0', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  ['qc-exit-t1', 'qc-rr-t1', 'qc-pnl-t1'].forEach((id) => ctx.__creer(id));
  remplir(ctx, { 'qc-rr-t1': '0', 'qc-pnl-t1': '0' });
  await ctx.submitQuickClose('t1');
  const [maj] = ecritures(db);
  assert.ok(maj, 'témoin : une écriture part');
  assert.equal(maj.op, 'update');
  assert.equal(maj.charge.status, 'closed');
  assert.equal(maj.charge.actual_rr, 0);
  assert.equal(maj.charge.pnl_amount, 0);
});

test('édition : un 0 en base s affiche 0 et n est pas remplacé par un calcul', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  lire(ctx, 'S').trades = [tradeFictif({ actual_rr: 0, pnl_amount: 0, entry_price: 160, sl_price: 159.5, exit_price: 160.5 })];
  await ctx.openTrade('t0');
  assert.equal(ctx.__el('m-arr').value, '0');
  assert.equal(ctx.__el('m-pnl').value, '0');
  await ctx.saveTrade();
  const [maj] = ecritures(db);
  assert.equal(maj.op, 'update', 'témoin : la resauvegarde part');
  assert.equal(maj.charge.actual_rr, 0);
  assert.equal(maj.charge.pnl_amount, 0);
});

test('édition : un R non saisi reste non saisi ; le calcul depuis les prix est proposé, pas écrit', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  lire(ctx, 'S').trades = [tradeFictif({ actual_rr: null, entry_price: 160, sl_price: 159.5, exit_price: 160.5 })];
  await ctx.openTrade('t0');
  assert.equal(ctx.__el('m-arr').value, '');
  const prop = ctx.__el('arr-display');
  assert.match(prop.innerHTML, /Calculé depuis les prix/, 'témoin : la proposition est rendue');
  assert.match(prop.innerHTML, /\+1\.00/);
  assert.equal(prop.style.display, 'block', 'la proposition est visible');
  await ctx.saveTrade();
  assert.equal(ecritures(db)[0].charge.actual_rr, null);
});

// ─── AJOUT 2 : virgule décimale, saisie illisible refusée ───
test('fiche : une saisie illisible est refusée avec un message sous le champ, rien n est écrit', async () => {
  for (const illisible of ['abc', '1 000', '1,5,3', '1.5R']) {
    const db = baseTrades();
    const ctx = charger({ db, muet: true });
    await ctx.openTrade();
    remplir(ctx, { ...MINIMUM, 'm-arr': illisible });
    await ctx.saveTrade();
    assert.deepEqual(ecritures(db), [], illisible + ' : aucune écriture');
    assert.match(ctx.__el('m-arr-msg').textContent, /illisible/, illisible + ' : message sous le champ');
  }
  // Témoin : la même fiche avec « -0,75 » part bien, et le message s'efface.
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  await ctx.openTrade();
  remplir(ctx, { ...MINIMUM, 'm-arr': 'x' });
  await ctx.saveTrade();
  remplir(ctx, { 'm-arr': '-0,75' });
  await ctx.saveTrade();
  assert.equal(ecritures(db)[0].charge.actual_rr, -0.75);
  assert.equal(ctx.__el('m-arr-msg').textContent, '');
});

test('clôture rapide : saisie illisible refusée sous le champ ; « -0,75 » vaut -0.75', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  ['qc-exit-t1', 'qc-rr-t1', 'qc-pnl-t1', 'qc-pnl-t1-msg'].forEach((id) => ctx.__creer(id));
  remplir(ctx, { 'qc-rr-t1': '-0,75', 'qc-pnl-t1': '12,50 $' });
  await ctx.submitQuickClose('t1');
  assert.deepEqual(ecritures(db), []);
  assert.match(ctx.__el('qc-pnl-t1-msg').textContent, /illisible/);
  remplir(ctx, { 'qc-pnl-t1': '-12,50' });
  await ctx.submitQuickClose('t1');
  const [maj] = ecritures(db);
  assert.ok(maj, 'témoin : la clôture part une fois corrigée');
  assert.equal(maj.charge.actual_rr, -0.75);
  assert.equal(maj.charge.pnl_amount, -12.5);
});

test('clôture rapide : un prix de sortie « 149,1 » sert au calcul du R', () => {
  const ctx = charger();
  ['qc-exit-t1', 'qc-rr-t1'].forEach((id) => ctx.__creer(id));
  ctx.__el('qc-exit-t1').value = '149,1';
  ctx.calcQuickRR('t1', 'LONG', 148.2, 147.6);
  assert.equal(ctx.__el('qc-rr-t1').value, '1.50');
});

test('champs de R, P&L et prix de sortie : texte + clavier décimal (pas type=number)', () => {
  const { SOURCE_HTML } = require('./charger-app.js');
  for (const id of ['m-arr', 'm-pnl']) {
    const balise = SOURCE_HTML.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
    assert.ok(balise, 'témoin : le champ ' + id + ' existe');
    assert.match(balise[0], /type="text"/);
    assert.match(balise[0], /inputmode="decimal"/);
  }
  const ctx = charger();
  const html = ctx.tradeHTML({ id: 't1', status: 'open', direction: 'LONG', instrument: 'EURUSD', trade_date: '2026-07-02' });
  for (const champ of ['exit', 'rr', 'pnl']) {
    const balise = html.match(new RegExp(`<input[^>]*id="qc-${champ}-t1"[^>]*>`));
    assert.ok(balise, 'témoin : le champ qc-' + champ + ' est rendu');
    assert.match(balise[0], /type="text"/);
    assert.match(balise[0], /inputmode="decimal"/);
  }
});

// ─── Constat 22 : « + Nouveau Trade » n'hérite de rien ───
test('nouveau trade après en avoir ouvert un autre : aucune valeur héritée (champs cachés compris)', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  lire(ctx, 'S').trades = [tradeFictif({
    direction: 'SHORT', status: 'closed', session: 'New York', timeframe: 'M15', setup_type: 'Liquidity sweep',
    plan_respected: 'not_respected', strategy: 'Order Block', account_id: 'acc-collegue', user_id: 'u-collegue', actual_rr: -1,
  })];
  await ctx.openTrade('t0');
  assert.equal(ctx.__el('m-sess').value, 'New York', 'témoin : la fiche d édition est bien remplie');
  assert.equal(ctx.__el('m-dir').value, 'SHORT');
  ctx.closeTrade();
  await ctx.openTrade();
  const vus = Object.fromEntries(['m-sess', 'm-tf', 'm-setup', 'm-strat', 'm-dir', 'm-status', 'm-plan', 'm-acc', 'm-user', 'm-arr']
    .map((id) => [id, ctx.__el(id).value]));
  assert.deepEqual(vus, {
    'm-sess': '', 'm-tf': '', 'm-setup': '', 'm-strat': '', 'm-dir': 'LONG', 'm-status': 'open', 'm-plan': '',
    'm-acc': '', 'm-user': '', 'm-arr': '',
  });
  remplir(ctx, MINIMUM);
  await ctx.saveTrade();
  const c = ecritures(db)[0].charge;
  assert.deepEqual([c.session, c.timeframe, c.setup_type, c.direction, c.status, c.plan_respected],
    [null, null, null, 'LONG', 'open', null]);
});

// ─── Constat 24 : « Respect du plan » non renseigné tant qu'on ne l'a pas choisi ───
// (select inerte dans node:vm : on lit la première option d'index.html, celle qu'un
// navigateur sélectionne par défaut ; le banc Playwright reste la preuve du rendu.)
function premiereOption(idSelect) {
  const { SOURCE_HTML } = require('./charger-app.js');
  const sel = SOURCE_HTML.match(new RegExp(`<select[^>]*id="${idSelect}"[^>]*>([\\s\\S]*?)</select>`));
  assert.ok(sel, 'témoin : le select ' + idSelect + ' existe');
  const opts = [...sel[1].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)];
  assert.ok(opts.length >= 3, 'témoin : ses options sont lues');
  return { valeur: opts[0][1], texte: opts[0][2] };
}

test('respect du plan : la première option (défaut du navigateur) est « non renseigné »', async () => {
  assert.deepEqual(premiereOption('m-plan'), { valeur: '', texte: '— Non renseigné —' });
  // Un nouveau trade part sans plan, une fiche d'édition sans plan reste sans plan.
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  lire(ctx, 'S').trades = [tradeFictif({ plan_respected: null }), tradeFictif({ id: 't2', plan_respected: 'partial' })];
  await ctx.openTrade('t2');
  assert.equal(ctx.__el('m-plan').value, 'partial', 'témoin : un plan saisi est repris');
  await ctx.openTrade('t0');
  assert.equal(ctx.__el('m-plan').value, '');
  await ctx.saveTrade();
  assert.equal(ecritures(db)[0].charge.plan_respected, null);
});

// ─── Constat 23 : qualité d'exécution non renseignée tant qu'elle n'est pas choisie ───
test('qualité : « non renseignée » par défaut ; un NULL reste NULL, une note saisie est reprise', async () => {
  assert.deepEqual(premiereOption('m-quality'), { valeur: '', texte: '— Non renseignée —' });
  const trades = [tradeFictif({ execution_quality: null }), tradeFictif({ id: 't2', execution_quality: 8 })];
  const db = baseTrades({}, trades);
  const ctx = charger({ db, muet: true });
  lire(ctx, 'S').trades = trades;
  await ctx.openTrade('t2');
  assert.equal(ctx.__el('m-quality').value, '8', 'témoin : une note saisie est reprise');
  await ctx.saveTrade();
  await ctx.openTrade('t0');
  assert.equal(ctx.__el('m-quality').value, '');
  await ctx.saveTrade();
  await ctx.openTrade();
  assert.equal(ctx.__el('m-quality').value, '');
  remplir(ctx, MINIMUM);
  await ctx.saveTrade();
  assert.deepEqual(ecritures(db).map((e) => e.charge.execution_quality), [8, null, null]);
});

// ─── Constat 21 : compte et trader choisis dans des listes visibles ───
const PIEGE = '"><tt-xss data-champ="test"></tt-xss>';
function espace(ctx, { comptes = 2 } = {}) {
  const S = lire(ctx, 'S');
  S.accounts = [{ id: 'acc-1', name: 'Compte A' }, { id: 'acc-2', name: 'Compte B' }].slice(0, comptes);
  S.users = [{ id: 'u-1', name: 'Trader Fictif' }, { id: 'u-2', name: 'Collègue Fictif' }];
  S.appUser = { id: 'u-1', name: 'Trader Fictif' };
  return S;
}

test('nouveau trade, plusieurs comptes : aucun compte présélectionné, refus en français sans écriture', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  espace(ctx);
  await ctx.openTrade();
  const acc = ctx.__el('m-acc');
  assert.match(acc.innerHTML, /<option value="">— Choisis un compte —<\/option>/);
  assert.match(acc.innerHTML, /<option value="acc-2">Compte B<\/option>/, 'témoin : les comptes sont listés');
  assert.equal(acc.value, '');
  assert.equal(ctx.__el('m-user').value, 'u-1', 'le trader connecté est présélectionné');
  ctx.__el('m-instr').value = 'eurusd';
  await ctx.saveTrade();
  assert.deepEqual(ecritures(db), [], 'rien n est enregistré sans compte');
  assert.equal(ctx.__el('m-acc-msg').textContent, 'Choisis un compte.');
  assert.match(ctx.__el('toast').textContent, /Choisis un compte/);
  acc.value = 'acc-2';
  await ctx.saveTrade();
  const [ins] = ecritures(db);
  assert.equal(ins.op, 'insert', 'témoin : une fois le compte choisi, le trade part');
  assert.deepEqual([ins.charge.account_id, ins.charge.user_id], ['acc-2', 'u-1']);
  assert.equal(ctx.__el('m-acc-msg').textContent, '');
});

test('nouveau trade, un seul compte : présélectionné (visible dans la liste)', async () => {
  const ctx = charger({ muet: true });
  espace(ctx, { comptes: 1 });
  await ctx.openTrade();
  assert.match(ctx.__el('m-acc').innerHTML, /<option value="acc-1">Compte A<\/option>/);
  assert.equal(ctx.__el('m-acc').value, 'acc-1');
});

test('nouveau trade après le trade d un collègue : ni son compte ni son nom ne sont repris', async () => {
  const ctx = charger({ muet: true });
  espace(ctx).trades = [tradeFictif({ account_id: 'acc-2', user_id: 'u-2' })];
  await ctx.openTrade('t0');
  assert.deepEqual([ctx.__el('m-acc').value, ctx.__el('m-user').value], ['acc-2', 'u-2'], 'témoin : fiche du collègue remplie');
  ctx.closeTrade();
  await ctx.openTrade();
  assert.deepEqual([ctx.__el('m-acc').value, ctx.__el('m-user').value], ['', 'u-1']);
});

test('édition : un compte absent de la liste (inactif) est conservé, pas perdu', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  espace(ctx).trades = [tradeFictif({ account_id: 'acc-ancien', accounts: { name: 'Ancien compte' } })];
  await ctx.openTrade('t0');
  assert.match(ctx.__el('m-acc').innerHTML, /<option value="acc-ancien">Ancien compte \(hors liste\)<\/option>/);
  assert.equal(ctx.__el('m-acc').value, 'acc-ancien');
  await ctx.saveTrade();
  assert.equal(ecritures(db)[0].charge.account_id, 'acc-ancien');
});

test('listes de comptes et de traders : noms échappés (XSS)', async () => {
  const ctx = charger({ muet: true });
  const S = espace(ctx);
  S.accounts = [{ id: 'acc-1', name: 'Compte' + PIEGE }];
  S.users = [{ id: 'u-1', name: 'Trader' + PIEGE }];
  await ctx.openTrade();
  for (const id of ['m-acc', 'm-user']) {
    const html = ctx.__el(id).innerHTML;
    assert.match(html, /(&quot;|")&gt;&lt;tt-xss/, 'témoin : le nom piégé est rendu, échappé (' + id + ')');
    assert.ok(!html.includes('<tt-xss'), 'aucune balise injectée (' + id + ')');
  }
});

test('refus de la base (champ obligatoire) : message lisible, fiche laissée ouverte', async () => {
  const db = baseTrades({ trades: { data: null, error: { code: '23502', message: 'null value in column "account_id" of relation "trades" violates not-null constraint' } } });
  const ctx = charger({ db, muet: true });
  await ctx.openTrade();
  remplir(ctx, MINIMUM);
  await ctx.saveTrade();
  assert.equal(ecritures(db).length, 1, 'témoin : l insertion a bien été tentée');
  assert.equal(ctx.__el('toast').textContent, 'Erreur : un champ obligatoire est vide');
  assert.ok(!ctx.__el('trade-modal').classList.contains('hidden'), 'la saisie n est pas perdue');
});

// ─── Constat 68 (partie fiche) : « + Nouveau Trade » en vue d'un autre espace ───
test('vue d un autre espace : « + Nouveau Trade » explique qu il faut revenir à son espace', async () => {
  const ctx = charger({ muet: true });
  const S = espace(ctx);
  Object.assign(S, { workspaceId: 'ws-maison', workspace: { name: 'Maison' }, currentWorkspaceId: 'ws-equipe', currentWorkspace: { name: 'Equipe' } });
  const modal = ctx.__el('trade-modal');
  modal.classList.add('hidden');
  await ctx.openTrade();
  assert.ok(modal.classList.contains('hidden'), 'la fiche ne s ouvre pas');
  assert.match(ctx.__el('toast').textContent, /Tu consultes Equipe : reviens à ton espace \(Maison\)/);
  // Témoin : dans son propre espace, la fiche s'ouvre.
  S.currentWorkspaceId = 'ws-maison'; S.currentWorkspace = { name: 'Maison' };
  await ctx.openTrade();
  assert.ok(!modal.classList.contains('hidden'));
});

// ─── Constat 25 : le R « Auto » suit la frappe du prix de sortie ───
function taper(ctx, id, texte, apres) {
  for (let i = 1; i <= texte.length; i++) { ctx.__el(id).value = texte.slice(0, i); apres(); }
}

test('clôture rapide : le R Auto suit chaque frappe (149.10 → +1.50, pas -245.33)', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  ['qc-exit-t1', 'qc-rr-t1', 'qc-pnl-t1'].forEach((id) => ctx.__creer(id));
  const vus = [];
  taper(ctx, 'qc-exit-t1', '149.10', () => { ctx.calcQuickRR('t1', 'LONG', 148.2, 147.6); vus.push(ctx.__el('qc-rr-t1').value); });
  assert.equal(vus[0], '-245.33', 'témoin : le premier caractère donne bien un premier calcul');
  assert.equal(ctx.__el('qc-rr-t1').value, '1.50');
  await ctx.submitQuickClose('t1');
  assert.equal(ecritures(db)[0].charge.actual_rr, 1.5);
  // Prix de sortie effacé : la valeur calculée s'efface aussi (elle n'a plus de source).
  ctx.__el('qc-exit-t1').value = '';
  ctx.calcQuickRR('t1', 'LONG', 148.2, 147.6);
  assert.equal(ctx.__el('qc-rr-t1').value, '');
});

test('clôture rapide : un R tapé à la main n est jamais écrasé par le calcul', () => {
  const ctx = charger();
  ['qc-exit-t1', 'qc-rr-t1'].forEach((id) => ctx.__creer(id));
  const html = ctx.tradeHTML({ id: 't1', status: 'open', direction: 'LONG', instrument: 'USDJPY', entry_price: 148.2, sl_price: 147.6 });
  const balise = html.match(/<input[^>]*id="qc-rr-t1"[^>]*>/);
  assert.ok(balise, 'témoin : le champ R est rendu');
  assert.match(balise[0], /oninput="delete this\.dataset\.auto"/, 'une frappe dans le R retire la marque « calculé »');
  taper(ctx, 'qc-exit-t1', '149', () => ctx.calcQuickRR('t1', 'LONG', 148.2, 147.6));
  assert.equal(ctx.__el('qc-rr-t1').value, '1.33', 'témoin : calculé tant que rien n est tapé');
  const rr = ctx.__el('qc-rr-t1');
  rr.value = '2'; delete rr.dataset.auto; // ce que fait l'oninput du champ
  taper(ctx, 'qc-exit-t1', '149.5', () => ctx.calcQuickRR('t1', 'LONG', 148.2, 147.6));
  assert.equal(rr.value, '2');
});

// ─── Constat 26 : « Auto » seulement si calculable ; clore sans R est dit ───
test('clôture rapide : « Auto » seulement si le R est calculable depuis l entrée et le SL', () => {
  const ctx = charger();
  const ph = (t) => ctx.tradeHTML({ id: 't1', status: 'open', direction: 'LONG', instrument: 'EURUSD', ...t })
    .match(/<input[^>]*id="qc-rr-t1"[^>]*placeholder="([^"]*)"/)[1];
  assert.equal(ph({ entry_price: 1.0842, sl_price: 1.0798 }), 'Auto', 'témoin : entrée + SL → Auto');
  assert.notEqual(ph({}), 'Auto', 'sans entrée ni SL');
  assert.notEqual(ph({ entry_price: 1.0842, sl_price: 1.09 }), 'Auto', 'SL du mauvais côté');
});

test('clôture sans R : possible, mais le message dit « R non saisi : mis à part »', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  ['qc-exit-t1', 'qc-rr-t1', 'qc-pnl-t1'].forEach((id) => ctx.__creer(id));
  ctx.__el('qc-exit-t1').value = '0,8655';
  await ctx.submitQuickClose('t1');
  const [maj] = ecritures(db);
  // v=6 (revue) : un R non tapé n'est pas envoyé (la base garde ce qu'elle a, ici rien)
  assert.deepEqual([maj.charge.exit_price, 'actual_rr' in maj.charge, maj.charge.status], [0.8655, false, 'closed']);
  assert.match(ctx.__el('toast').textContent, /R non saisi : mis à part dans les stats/);
  ctx.__el('qc-rr-t1').value = '1,2';
  await ctx.submitQuickClose('t1');
  assert.equal(ctx.__el('toast').textContent, 'Trade clôturé ✅', 'témoin : avec un R, message habituel');
});

test('fiche : un trade enregistré « Fermé » sans R le dit aussi', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  await ctx.openTrade();
  remplir(ctx, { ...MINIMUM, 'm-status': 'closed' });
  await ctx.saveTrade();
  assert.match(ctx.__el('toast').textContent, /R non saisi : mis à part dans les stats/);
  await ctx.openTrade();
  remplir(ctx, { ...MINIMUM, 'm-status': 'closed', 'm-arr': '0' });
  await ctx.saveTrade();
  assert.equal(ctx.__el('toast').textContent, 'Trade sauvegardé ✅', 'témoin : un BE (0) saisi n est pas « non saisi »');
  assert.equal(ecritures(db).length, 2);
});

// ─── Constat 28 : une capture qui échoue n'est jamais annoncée comme sauvegardée ───
// Stockage simulé : l'envoi d'un onglet peut échouer (erreur rendue) ou lever (réseau).
function stockage(db, { refus = [], leve = [] } = {}) {
  const envoyes = []; const retraits = [];
  const vrai = db.storage.from;
  db.storage.from = (b) => ({
    ...vrai(b),
    upload: async (chemin) => {
      const type = chemin.split('/')[2];
      if (leve.includes(type)) throw new Error('Failed to fetch');
      if (refus.includes(type)) return { data: null, error: { message: 'The object exceeded the maximum allowed size' } };
      envoyes.push(chemin); return { data: {}, error: null };
    },
    remove: async (chemins) => { retraits.push(...chemins); return { data: [], error: null }; },
  });
  return { envoyes, retraits };
}
const fichier = (nom) => ({ name: nom, type: 'image/png', size: 10 });

async function ficheAvecCaptures(db, captures) {
  const ctx = charger({ db, muet: true });
  await ctx.openTrade();
  remplir(ctx, MINIMUM);
  const S = lire(ctx, 'S');
  for (const [nom, type] of captures) S.pendingUps.push({ file: fichier(nom), type });
  const modal = ctx.__el('trade-modal');
  return { ctx, S, modal };
}

test('capture refusée à l envoi : message d erreur, fiche ouverte avec la seule capture à renvoyer', async () => {
  const db = baseTrades();
  stockage(db, { refus: ['entry'] });
  const { ctx, S, modal } = await ficheAvecCaptures(db, [['entree.png', 'entry'], ['sortie.png', 'close']]);
  await ctx.saveTrade();
  const toast = ctx.__el('toast');
  assert.match(toast.textContent, /Trade enregistré, mais 1 capture sur 2 non envoyée \(entree\.png\)/);
  assert.ok(toast.className.includes('err'), 'message d erreur, pas de succès');
  assert.doesNotMatch(toast.textContent, /sauvegardé ✅/);
  assert.ok(!modal.classList.contains('hidden'), 'la fiche reste ouverte');
  assert.match(ctx.__el('m-save-msg').textContent, /« Sauvegarder » pour réessayer/, 'le message reste dans la fiche');
  assert.deepEqual(horsContexte(S.pendingUps.map((p) => p.file.name)), ['entree.png'], 'seule la capture en échec reste à envoyer');
  assert.equal(ecritures(db, 'trade_images').length, 1, 'témoin : la capture réussie est enregistrée');
  assert.equal(S.editId, 't-nouveau', 'la fiche vise désormais le trade créé');
  // Réessai réussi : le trade est MODIFIÉ (pas recréé), la capture part, la fiche se ferme.
  db.storage.from = faireDb().storage.from;
  ctx.actionUtilisateur(); // le clic sur « Sauvegarder » (lève la protection de l'avertissement)
  await ctx.saveTrade();
  assert.deepEqual(ecritures(db).map((e) => e.op), ['insert', 'update'], 'aucun trade en double');
  assert.equal(ecritures(db, 'trade_images').length, 2);
  assert.equal(toast.textContent, 'Trade sauvegardé ✅');
  assert.ok(modal.classList.contains('hidden'));
});

test('capture envoyée mais non enregistrée (droits) : échec annoncé, fichier orphelin retiré', async () => {
  const db = baseTrades({ trade_images: (etat) => (etat.op === 'insert' ? { data: null, error: { message: 'refus' } } : { data: [], error: null }) });
  const st = stockage(db);
  const { ctx, modal } = await ficheAvecCaptures(db, [['analyse.png', 'file']]);
  await ctx.saveTrade();
  assert.match(ctx.__el('toast').textContent, /1 capture sur 1 non envoyée \(analyse\.png\)/);
  assert.ok(!modal.classList.contains('hidden'));
  assert.equal(st.envoyes.length, 1, 'témoin : le fichier était bien parti au stockage');
  assert.deepEqual(horsContexte(st.retraits), horsContexte(st.envoyes), 'le fichier orphelin est retiré');
});

test('envoi qui lève (réseau) : compté comme un échec, pas d exception muette', async () => {
  const db = baseTrades();
  stockage(db, { leve: ['close'] });
  const { ctx, modal } = await ficheAvecCaptures(db, [['sortie.png', 'close']]);
  await ctx.saveTrade();
  assert.match(ctx.__el('toast').textContent, /Trade enregistré, mais 1 capture sur 1 non envoyée \(sortie\.png\)/);
  assert.ok(!modal.classList.contains('hidden'));
});

test('captures toutes envoyées : succès habituel, fiche fermée', async () => {
  const db = baseTrades();
  const st = stockage(db);
  const { ctx, modal } = await ficheAvecCaptures(db, [['entree.png', 'entry'], ['sortie.png', 'close']]);
  await ctx.saveTrade();
  assert.equal(st.envoyes.length, 2);
  assert.equal(ecritures(db, 'trade_images').length, 2);
  assert.equal(ctx.__el('toast').textContent, 'Trade sauvegardé ✅');
  assert.ok(modal.classList.contains('hidden'));
});

// ─── AJOUT 3 : une capture collée depuis « Analyse » est visible dans « Analyse » ───
function coller(ctx, nom) {
  let empeche = false;
  ctx.handleGlobalPaste({
    clipboardData: { items: [{ type: 'image/png', getAsFile: () => fichier(nom) }] },
    preventDefault: () => { empeche = true; },
  });
  return empeche;
}

test('fiche : un collage va dans l onglet ouvert et le message nomme la destination', async () => {
  const ctx = charger({ muet: true });
  await ctx.openTrade(); // s'ouvre sur « Analyse »
  const S = lire(ctx, 'S');
  assert.ok(coller(ctx, 'analyse.png'), 'témoin : le collage est pris par la fiche');
  assert.equal(S.pendingUps.at(-1).type, 'file');
  assert.match(ctx.__el('toast').textContent, /Capture ajoutée à l'onglet Analyse/);
  ctx.mTab(1, null);
  coller(ctx, 'entree.png');
  assert.equal(S.pendingUps.at(-1).type, 'entry');
  assert.match(ctx.__el('toast').textContent, /Capture ajoutée à l'onglet Exécution/);
  ctx.mTab(2, null);
  coller(ctx, 'sortie.png');
  assert.equal(S.pendingUps.at(-1).type, 'close');
  assert.match(ctx.__el('toast').textContent, /Clôture/);
  assert.equal(S.pendingUps.length, 3);
});

test('fiche : la grille des captures d analyse est dans l onglet Analyse, visible (saisie et réouverture)', () => {
  const { SOURCE_HTML } = require('./charger-app.js');
  const onglet = (n) => SOURCE_HTML.slice(SOURCE_HTML.indexOf(`id="mt-${n}"`), SOURCE_HTML.indexOf(`id="mt-${n + 1}"`));
  assert.match(onglet(1), /id="prev-entry"/, 'témoin : la grille d entrée est dans Exécution');
  const analyse = onglet(0);
  assert.match(analyse, /<div class="img-grid" id="prev-file"><\/div>/, 'grille des captures d analyse dans Analyse, sans style qui la cache');
  assert.match(analyse, /onchange="addUpload\(this,'file'\)"/, 'on peut aussi y joindre une capture');
  assert.doesNotMatch(SOURCE_HTML, /class="modal-tc"[^>]*display:none/, 'aucun onglet caché d office');
});

// ─── AJOUT 4 : un champ vide ne ressemble jamais à une valeur ───
function texteIndicatif(html, id) {
  const balise = html.match(new RegExp(`<(input|textarea)[^>]*id="${id}"[^>]*>`));
  assert.ok(balise, 'témoin : le champ ' + id + ' existe');
  const ph = balise[0].match(/placeholder="([^"]*)"/);
  assert.ok(ph, 'le champ ' + id + ' a un texte indicatif');
  return ph[1];
}

test('textes indicatifs des champs de valeur : aucun chiffre (pas de « 2.5 » ni « 0.00 » dans un champ vide)', () => {
  const { SOURCE_HTML } = require('./charger-app.js');
  for (const id of ['m-arr', 'm-pnl']) assert.doesNotMatch(texteIndicatif(SOURCE_HTML, id), /\d/, id);
  const ctx = charger();
  const html = ctx.tradeHTML({ id: 't1', status: 'open', direction: 'LONG', instrument: 'EURUSD', entry_price: 1.08, sl_price: 1.07 });
  for (const champ of ['exit', 'rr', 'pnl']) assert.doesNotMatch(texteIndicatif(html, 'qc-' + champ + '-t1'), /\d/, 'qc-' + champ);
  // Exemples de texte libre : annoncés comme exemples.
  for (const id of ['m-instr', 'm-mgmt']) assert.match(texteIndicatif(SOURCE_HTML, id), /^ex\./, id);
});

test('fiche d un trade clos sans R : « R non saisi » dit sous le champ ; un BE à 0 ne le dit pas', async () => {
  const ctx = charger({ muet: true });
  lire(ctx, 'S').trades = [tradeFictif({ actual_rr: null }), tradeFictif({ id: 't2', actual_rr: 0 }), tradeFictif({ id: 't3', status: 'open', actual_rr: null })];
  await ctx.openTrade('t0');
  assert.match(ctx.__el('m-arr-msg').textContent, /R non saisi : ce trade est mis à part dans les stats/);
  assert.equal(ctx.__el('m-arr-msg').style.display, 'block');
  await ctx.openTrade('t2');
  assert.equal(ctx.__el('m-arr-msg').textContent, '', 'BE saisi : pas de mention');
  await ctx.openTrade('t3');
  assert.equal(ctx.__el('m-arr-msg').textContent, '', 'trade en cours : pas de mention');
});

// ─── Constat 11 (intégration v=6) : le P&L se saisit dans la devise du compte ───
// (avant : « P&L ($) » pour tout compte, alors qu'il s'affiche dans la devise du compte)
test('fiche et clôture rapide : le libellé du P&L donne la devise du compte choisi', async () => {
  const COMPTES = [{ id: 'acc-eur', name: 'Compte EUR', currency: 'EUR', is_active: true }, { id: 'acc-usd', name: 'Compte USD', currency: 'USD', is_active: true }];
  const ctx = charger({ db: baseTrades(), muet: true });
  const S = lire(ctx, 'S');
  S.accounts = COMPTES;
  S.trades = [tradeFictif({ account_id: 'acc-eur', accounts: { name: 'Compte EUR', currency: 'EUR' } })];
  await ctx.openTrade('t0');
  assert.equal(ctx.__el('m-pnl-lbl').textContent, 'P&L (€)', 'compte du trade en EUR');
  ctx.__el('m-acc').value = 'acc-usd';
  ctx.majLibellePnl(); // changement de compte dans la fiche (onchange de m-acc)
  assert.equal(ctx.__el('m-pnl-lbl').textContent, 'P&L ($US)');
  // Clôture rapide (journal) : la devise du compte du trade
  assert.match(ctx.tradeHTML(tradeFictif({ id: 't9', status: 'open', account_id: 'acc-eur', accounts: { currency: 'EUR' } })), /<label class="fl">P&amp;L \(€\)<\/label>/);
  assert.match(ctx.tradeHTML(tradeFictif({ id: 't8', status: 'open', account_id: 'acc-usd', accounts: { currency: 'USD' } })), /<label class="fl">P&amp;L \(\$US\)<\/label>/);
  // Nouveau trade, plusieurs comptes, aucun encore choisi : on ne devine pas la devise
  const neuf = charger({ db: baseTrades(), muet: true });
  lire(neuf, 'S').accounts = COMPTES;
  await neuf.openTrade();
  assert.equal(neuf.__el('m-pnl-lbl').textContent, 'P&L (devise du compte)');
  assert.match(fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8'), /id="m-acc" onchange="[^"]*majLibellePnl\(\)/, 'le libellé suit le compte choisi');
});

// ─── Revue v=6 : la clôture rapide ne détruit jamais une saisie ───
// Trade EN COURS dont R, P&L et sortie ont déjà été saisis dans la fiche.
const ouvertSaisi = (extra = {}) => tradeFictif({ id: 't1', status: 'open', direction: 'LONG', entry_price: 1.0842, sl_price: 1.0798,
  exit_price: 1.0908, actual_rr: 1.5, pnl_amount: 150, accounts: { name: 'Compte A', currency: 'USD' }, ...extra });
const qcVides = (ctx) => ['qc-exit-t1', 'qc-rr-t1', 'qc-pnl-t1'].forEach((id) => ctx.__creer(id));

test('clôture rapide : les champs reprennent les valeurs déjà saisies (0 compris)', () => {
  const ctx = charger({ muet: true });
  const html = ctx.tradeHTML(ouvertSaisi({ pnl_amount: 0 }));
  assert.match(html, /id="qc-exit-t1"[^>]*value="1\.0908"|value="1\.0908"[^>]*id="qc-exit-t1"/);
  assert.match(html, /<input[^>]*id="qc-rr-t1"[^>]*>/, 'témoin : le champ R est rendu');
  assert.match(html.match(/<input[^>]*id="qc-rr-t1"[^>]*>/)[0], /value="1\.5"/);
  assert.match(html.match(/<input[^>]*id="qc-pnl-t1"[^>]*>/)[0], /value="0"/, 'un P&L de 0 (BE) est repris');
  assert.match(ctx.tradeHTML(ouvertSaisi({ actual_rr: null })).match(/<input[^>]*id="qc-rr-t1"[^>]*>/)[0], /value=""/, 'rien de saisi : champ vide');
});

test('clôture rapide : « Valider » sans rien taper garde R, P&L et sortie déjà saisis', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  lire(ctx, 'S').trades = [ouvertSaisi()];
  qcVides(ctx);
  await ctx.submitQuickClose('t1');
  const [maj] = ecritures(db);
  assert.ok(maj, 'témoin : la clôture part');
  assert.equal(maj.charge.status, 'closed');
  for (const c of ['exit_price', 'actual_rr', 'pnl_amount']) assert.ok(!(c in maj.charge) || maj.charge[c] !== null, c + ' effacé');
  assert.match(ctx.__el('toast').textContent, /Trade clôturé ✅/, 'le R est en base : pas de « R non saisi »');
});

test('clôture rapide : le seul prix de sortie tapé ne remplace pas le P&L saisi ; un R tapé l emporte', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  lire(ctx, 'S').trades = [ouvertSaisi()];
  qcVides(ctx);
  remplir(ctx, { 'qc-exit-t1': '1,0920', 'qc-rr-t1': '1,8' });
  await ctx.submitQuickClose('t1');
  const [maj] = ecritures(db);
  assert.equal(maj.charge.exit_price, 1.092);
  assert.equal(maj.charge.actual_rr, 1.8);
  assert.ok(!('pnl_amount' in maj.charge) || maj.charge.pnl_amount === 150, 'P&L saisi gardé');
  // Témoin : rien en base et rien tapé → clos, et « R non saisi » est dit
  const db2 = baseTrades();
  const ctx2 = charger({ db: db2, muet: true });
  lire(ctx2, 'S').trades = [ouvertSaisi({ exit_price: null, actual_rr: null, pnl_amount: null })];
  qcVides(ctx2);
  await ctx2.submitQuickClose('t1');
  assert.equal(ecritures(db2)[0].charge.status, 'closed');
  assert.match(ctx2.__el('toast').textContent, /R non saisi/);
});

// ─── Revue v=6 : une écriture qui ne touche aucune ligne n'est pas un succès ───
// UPDATE/DELETE … WHERE id = X sans ligne visible (trade supprimé entre-temps, accès
// retiré « à la requête suivante ») répond SANS erreur ; avec {count:'exact'}, le
// serveur dit 0. Un nombre non communiqué (undefined) n'est pas pris pour un échec.
const lignes = (count) => (etat) => (etat.op === 'select' ? { data: [], error: null } : { data: [], error: null, count });

test('écriture sans ligne touchée : ni « sauvegardé ✅ », ni « clôturé ✅ », ni « supprimé » ; la fiche reste ouverte', async () => {
  // Fiche (modification)
  let db = faireDb({ reponses: { trades: lignes(0) } });
  let ctx = charger({ db, muet: true });
  let S = lire(ctx, 'S');
  S.accounts = [{ id: 'acc-1', name: 'Compte A' }]; S.users = [{ id: 'u-1', name: 'Trader Fictif' }];
  S.trades = [ouvertSaisi({ status: 'closed' })];
  await ctx.openTrade('t1');
  await ctx.saveTrade();
  assert.equal(ecritures(db)[0].op, 'update', 'témoin : la modification est tentée');
  assert.match(ctx.__el('toast').textContent, /Rien n'a été enregistré : ce trade n'existe plus ou tu n'y as plus accès/);
  assert.ok(!ctx.__el('trade-modal').classList.contains('hidden'), 'la fiche reste ouverte (saisie gardée)');
  // Clôture rapide
  db = faireDb({ reponses: { trades: lignes(0) } });
  ctx = charger({ db, muet: true });
  qcVides(ctx);
  remplir(ctx, { 'qc-rr-t1': '1,5' });
  await ctx.submitQuickClose('t1');
  assert.equal(ecritures(db).length, 1, 'témoin : la clôture est tentée');
  assert.match(ctx.__el('toast').textContent, /Rien n'a été clôturé/);
  // Suppression
  db = faireDb({ reponses: { trades: lignes(0) } });
  ctx = charger({ db, muet: true });
  lire(ctx, 'S').editId = 't1';
  await ctx.deleteTrade();
  await lire(ctx, 'S').confirmCb();
  assert.equal(ecritures(db)[0].op, 'delete', 'témoin : la suppression est tentée');
  assert.match(ctx.__el('toast').textContent, /Rien n'a été supprimé/);
});

test('écritures d un trade : le nombre de lignes est DEMANDÉ au serveur (sans lui, la garde ne voit rien)', async () => {
  const db = baseTrades();
  const ctx = charger({ db, muet: true });
  const S = lire(ctx, 'S');
  S.accounts = [{ id: 'acc-1', name: 'Compte A' }]; S.users = [{ id: 'u-1', name: 'Trader Fictif' }];
  S.trades = [ouvertSaisi({ status: 'closed' })];
  await ctx.openTrade('t1');
  await ctx.saveTrade();
  qcVides(ctx);
  await ctx.submitQuickClose('t1');
  S.editId = 't1';
  await ctx.deleteTrade();
  await S.confirmCb();
  const [fiche, cloture, suppression] = ecritures(db);
  assert.deepEqual([fiche.op, cloture.op, suppression.op], ['update', 'update', 'delete'], 'témoin : les trois écritures partent');
  assert.equal(fiche.options?.count, 'exact');
  assert.equal(cloture.options?.count, 'exact');
  assert.equal(suppression.charge?.count, 'exact', 'delete : les options sont le 1er argument');
});

test('écriture avec une ligne touchée, ou nombre non communiqué : le succès est annoncé (témoin)', async () => {
  for (const count of [1, undefined]) {
    let db = faireDb({ reponses: { trades: lignes(count) } });
    let ctx = charger({ db, muet: true });
    qcVides(ctx);
    remplir(ctx, { 'qc-rr-t1': '1,5' });
    await ctx.submitQuickClose('t1');
    assert.equal(ctx.__el('toast').textContent, 'Trade clôturé ✅', 'count ' + count);
    db = faireDb({ reponses: { trades: lignes(count) } });
    ctx = charger({ db, muet: true });
    lire(ctx, 'S').editId = 't1';
    await ctx.deleteTrade();
    await lire(ctx, 'S').confirmCb();
    assert.equal(ctx.__el('toast').textContent, 'Trade supprimé', 'count ' + count);
  }
});

// ─── Revue v=6 : comptes non chargés ≠ « aucun compte actif » ───
test('fiche Nouveau Trade, lecture des comptes en échec : « Comptes non chargés », et le refus dit cette cause', async () => {
  const db = faireDb({ reponses: { accounts: { data: null, error: { message: 'Failed to fetch' } } } });
  const ctx = charger({ db, muet: true });
  assert.equal(await ctx.loadAccounts(), false, 'témoin : la lecture des comptes échoue');
  lire(ctx, 'S').appUser = { id: 'u-1', name: 'Trader Fictif' };
  await ctx.openTrade();
  const liste = ctx.__el('m-acc').innerHTML;
  assert.match(liste, /Comptes non chargés \(réseau ou serveur\)/);
  assert.doesNotMatch(liste, /Aucun compte actif/);
  remplir(ctx, { 'm-instr': 'eurusd' });
  await ctx.saveTrade();
  assert.deepEqual(ecritures(db), [], 'rien n est écrit');
  assert.match(ctx.__el('toast').textContent, /Comptes non chargés/);
  assert.match(ctx.__el('m-acc-msg').textContent, /Comptes non chargés/);
  // Témoin : lecture réussie et vraiment vide → « Aucun compte actif » est juste
  const vide = charger({ muet: true });
  assert.equal(await vide.loadAccounts(), true);
  await vide.openTrade();
  assert.match(vide.__el('m-acc').innerHTML, /Aucun compte actif/);
});
