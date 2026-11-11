'use strict';
// v=6 « données honnêtes » — tableau de bord (panneau de statistiques).
// Chaque garde APPELLE le code (calcStats, renderStatsPanel, renderStats,
// renderStatsByMonths, onDashYearChange) et porte un témoin positif : un
// rendu vide ne doit pas passer.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire, injecter, horsContexte } = require('./charger-app.js');

let n = 0;
function trade(statut, rr, date, extra = {}) {
  n += 1;
  return {
    id: 'td-' + n, status: statut, actual_rr: rr, trade_date: date, created_at: date + 'T10:00:00Z',
    instrument: 'EURUSD', direction: 'LONG', is_test: false, ...extra,
  };
}
// Le panneau rendu, en texte (balises retirées, espaces normalisés).
function texte(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function panneau(ctx, trades, label = 'JUILLET 2026', periode = 'juillet 2026') {
  ctx.renderStatsPanel(ctx.calcStats(trades), label, periode);
  return ctx.__el('stats-row').innerHTML;
}

// ─── Constat 0 : trade clos sans R saisi mis à part (arbitrage 1) ───
test('calcStats : un clos sans R saisi n est ni un BE ni au denominateur du taux', () => {
  const ctx = charger();
  const st = horsContexte(ctx.calcStats([
    trade('closed', 1.5, '2026-07-02'),
    trade('closed', null, '2026-07-03'),
    trade('closed', '', '2026-07-04'),
  ]));
  assert.equal(st.closed, 3, 'temoin : les trois sont clos');
  assert.equal(st.wins, 1);
  assert.equal(st.be, 0, 'un R non saisi n est pas un break-even');
  assert.equal(st.sansR, 2);
  assert.equal(st.winRate, 100, '1 gagnant sur 1 trade juge');
  assert.equal(st.totalRR, 1.5);
  // Temoin : un vrai 0 saisi reste un BE, au denominateur.
  const be = horsContexte(ctx.calcStats([trade('closed', 1.5, '2026-07-02'), trade('closed', 0, '2026-07-03')]));
  assert.equal(be.be, 1);
  assert.equal(be.sansR, 0);
  assert.equal(be.winRate, 50);
});

test('panneau : « N trades clos sans R saisi » et aucun B/E invente', () => {
  const ctx = charger();
  const html = panneau(ctx, [trade('closed', 1.5, '2026-07-02'), trade('closed', null, '2026-07-03'), trade('closed', null, '2026-07-06')]);
  const t = texte(html);
  assert.match(t, /JUILLET 2026/, 'temoin positif : le panneau est rendu');
  assert.match(t, /2 trades clos sans R saisi/);
  assert.match(t, /1 WIN 0 B\/E 0 LOSS/);
  assert.match(t, /100 %/, 'taux sur les seuls trades juges');
  // Temoin : sans trade a completer, aucune mention.
  assert.doesNotMatch(texte(panneau(ctx, [trade('closed', 1.5, '2026-07-02')])), /sans R saisi/);
});

// ─── Constat 6 : période sans trade clos, taux inconnu ───
test('compteur : pas d aiguille quand le taux est inconnu', () => {
  const ctx = charger();
  assert.match(ctx.speedometerHTML(50, ''), /<line /, 'temoin : un taux connu a son aiguille');
  assert.doesNotMatch(ctx.speedometerHTML(null, ''), /<line /);
  assert.match(ctx.speedometerHTML(null, ''), /<path /, 'l arc reste dessine');
});

test('periode sans trade clos : « Aucun trade clos sur octobre 2026 », pas de zeros', () => {
  const ctx = charger({ maintenant: new Date('2026-10-21T10:00:00+02:00') });
  lire(ctx, 'S').trades = [trade('open', null, '2026-10-02'), trade('closed', 2, '2026-09-15')];
  ctx.renderStatsByMonths(['2026-9']);
  const t = texte(ctx.__el('stats-row').innerHTML);
  assert.match(t, /OCTOBRE 2026/, 'temoin positif : le panneau est rendu');
  assert.match(t, /Aucun trade clos sur octobre 2026 · 1 trade en cours/);
  assert.doesNotMatch(t, /0 %|WIN 0%|\+0\.00/, 'aucune rangee de zeros');
  // Temoin : septembre (un trade clos) affiche bien les chiffres.
  ctx.renderStatsByMonths(['2026-8']);
  const sept = texte(ctx.__el('stats-row').innerHTML);
  assert.match(sept, /\+2\.00 R/);
  assert.doesNotMatch(sept, /Aucun trade clos/);
});

test('trades clos tous sans R : taux « — » sans aiguille, total R « — », pas de barre WIN/BE/LOSS', () => {
  const ctx = charger();
  const st = horsContexte(ctx.calcStats([trade('closed', null, '2026-07-02')]));
  assert.equal(st.winRate, null, 'taux inconnu, pas 0');
  const html = panneau(ctx, [trade('closed', null, '2026-07-02')]);
  const t = texte(html);
  assert.match(t, /1 trade clos sans R saisi/, 'temoin positif');
  assert.match(t, /TRADE WIN % —/);
  assert.match(t, /^JUILLET 2026 Tous les traders de l'espace — R/);
  assert.doesNotMatch(html, /<line /, 'pas d aiguille');
  assert.doesNotMatch(t, /WIN 0%/);
  // Temoin : avec un trade juge, l aiguille et la barre reviennent.
  const ok = panneau(ctx, [trade('closed', 1, '2026-07-02')]);
  assert.match(ok, /<line /);
  assert.match(texte(ok), /WIN 100%/);
});

// ─── Constat 10 : trades de test exclus des statistiques (arbitrage 3) ───
test('ALL TIME : les trades de test ne sont pas comptes, et le panneau le dit', () => {
  const ctx = charger();
  const S = lire(ctx, 'S');
  S.trades = [
    trade('closed', -1, '2026-07-02'),
    trade('closed', 2, '2025-01-10', { is_test: true }),
    trade('closed', 3, '2025-01-11', { is_test: true }),
    trade('cancelled', 5, '2025-01-12', { is_test: true }),
  ];
  ctx.renderStats();
  const t = texte(ctx.__el('stats-row').innerHTML);
  assert.match(t, /ALL TIME/, 'temoin positif : le panneau est rendu');
  assert.match(t, /-1\.00 R/, 'seul le trade reel est compte');
  assert.match(t, /0 WIN 0 B\/E 1 LOSS/);
  assert.match(t, /2 trades de test non comptés/, 'le test annule n est pas annonce');
  // Temoin : le meme trade sans le drapeau test est compte.
  S.trades = [trade('closed', -1, '2026-07-02'), trade('closed', 2, '2025-01-10')];
  ctx.renderStats();
  const reel = texte(ctx.__el('stats-row').innerHTML);
  assert.match(reel, /\+1\.00 R/);
  assert.doesNotMatch(reel, /de test/);
});

test('selection par mois : trades de test exclus, mention dans le panneau', () => {
  const ctx = charger();
  const S = lire(ctx, 'S');
  S.trades = [
    trade('closed', 1, '2026-07-02', { id: 'reel' }),
    trade('closed', 4, '2026-07-03', { id: 'test', is_test: true }),
    trade('cancelled', 2, '2026-07-04', { id: 'annule' }),
  ];
  assert.deepEqual(horsContexte(ctx.getTradesForMonths(['2026-6']).map((t) => t.id)), ['reel']);
  ctx.renderStatsByMonths(['2026-6']);
  const t = texte(ctx.__el('stats-row').innerHTML);
  assert.match(t, /JUILLET 2026 Tous les traders de l'espace \+1\.00 R/, 'temoin positif');
  assert.match(t, /1 trade de test non compté/);
});

// ─── Constats 2, 4, 5, 11 : la ligne P&L (arbitrage 2) ───
const USD = { name: 'Compte USD', currency: 'USD' };
const EUR = { name: 'Compte EUR', currency: 'EUR' };
function comptes(ctx, liste) { lire(ctx, 'S').accounts = liste; }

test('P&L jamais saisi : « P&L non saisi », ni « $0 » ni « 0 % »', () => {
  const ctx = charger();
  comptes(ctx, [{ id: 'a', currency: 'USD', balance: 10000, is_active: true }]);
  const html = panneau(ctx, [trade('closed', 1.5, '2026-07-02', { accounts: USD }), trade('closed', -1, '2026-07-03', { accounts: USD })]);
  const t = texte(html);
  assert.match(t, /\+0\.50 R/, 'temoin positif : le total R est rendu');
  assert.match(t, /P&(amp;)?L non saisi/);
  assert.doesNotMatch(t, /\$|%  ·|0\.00%/);
  // Temoin : un P&L saisi a 0 est une valeur, affichee.
  const zero = texte(panneau(ctx, [trade('closed', 0, '2026-07-02', { accounts: USD, pnl_amount: 0 })]));
  assert.match(zero, /0\.00% · 0\s\$US/);
  assert.doesNotMatch(zero, /non saisi/);
});

test('P&L partiel et de signe oppose au R : signe et couleur pris sur le P&L, « sur 1 des 2 trades clos »', () => {
  const ctx = charger();
  comptes(ctx, [{ id: 'a', currency: 'USD', balance: 10000, is_active: true }]);
  const html = panneau(ctx, [
    trade('closed', 2, '2026-07-02', { accounts: USD }),
    trade('closed', -1, '2026-07-03', { accounts: USD, pnl_amount: -150 }),
  ]);
  const t = texte(html);
  assert.match(t, /\+1\.00 R/, 'temoin : le R reste positif');
  assert.match(t, /-1\.50% · -150\s\$US · sur 1 des 2 trades clos/);
  assert.doesNotMatch(t, /\+-/);
  assert.match(html, /<span class="neg">-1\.50%<\/span>/, 'le % negatif est en rouge');
  assert.match(html, /<span class="neg">-150\s\$US<\/span>/);
});

test('% du P&L : somme des soldes des comptes actifs de meme devise, « — » sinon', () => {
  const ctx = charger();
  const gain = [trade('closed', 2, '2026-07-02', { accounts: USD, pnl_amount: 200 })];
  comptes(ctx, [
    { id: 'a', currency: 'USD', balance: 6000, is_active: true },
    { id: 'b', currency: 'USD', balance: 4000, is_active: true },
    { id: 'c', currency: 'EUR', balance: 5000, is_active: true },
    { id: 'd', currency: 'USD', balance: 90000, is_active: false },
  ]);
  assert.match(texte(panneau(ctx, gain)), /\+2\.00% · \+200\s\$US/, 'temoin : 200 / (6000 + 4000)');
  comptes(ctx, []);
  const sansCompte = texte(panneau(ctx, gain));
  assert.match(sansCompte, /— % · \+200\s\$US/, 'aucun compte : pas de solde invente');
  comptes(ctx, [{ id: 'a', currency: 'USD', balance: 0, is_active: true }, { id: 'b', currency: 'USD', balance: 50000, is_active: false }]);
  assert.match(texte(panneau(ctx, gain)), /— % · \+200\s\$US/, 'solde nul : pas « 0 % »');
});

test('devise : symbole pris du compte, devises differentes jamais additionnees', () => {
  const ctx = charger();
  comptes(ctx, [{ id: 'e', currency: 'EUR', balance: 5000, is_active: true }]);
  const eur = texte(panneau(ctx, [trade('closed', 1, '2026-07-02', { accounts: EUR, pnl_amount: 250 })]));
  assert.match(eur, /\+5\.00% · \+250\s€/, 'temoin positif : compte en EUR');
  assert.doesNotMatch(eur, /\$/);
  comptes(ctx, [{ id: 'a', currency: 'USD', balance: 10000, is_active: true }, { id: 'e', currency: 'EUR', balance: 5000, is_active: true }]);
  const mix = texte(panneau(ctx, [
    trade('closed', 1, '2026-07-02', { accounts: USD, pnl_amount: 100 }),
    trade('closed', 1, '2026-07-03', { accounts: EUR, pnl_amount: 100 }),
  ]));
  assert.match(mix, /— % · \+100\s\$US · \+100\s€ \(devises différentes, non additionnées\)/);
  assert.doesNotMatch(mix, /\+200/);
  const st = horsContexte(ctx.calcStats([trade('closed', 1, '2026-07-02', { accounts: USD, pnl_amount: 100 }), trade('closed', 1, '2026-07-03', { accounts: EUR, pnl_amount: 100 })]));
  assert.equal(st.totalPnL, null, 'pas de total entre devises');
});

test('devise illisible en base : echappee, jamais interpretee', () => {
  const ctx = charger();
  comptes(ctx, []);
  const html = panneau(ctx, [trade('closed', 1, '2026-07-02', { accounts: { currency: '<tt-xss>' }, pnl_amount: 10 })]);
  assert.match(html, /\+10 &lt;tt-xss&gt;/, 'temoin positif : le montant est rendu');
  assert.ok(!html.includes('<tt-xss'));
});

// ─── Constat 12 : le libelle dit que les chiffres couvrent tout l espace ───
test('libelle : « Tous les traders de l espace », traders et comptes de la periode', () => {
  const ctx = charger();
  const t = texte(panneau(ctx, [
    trade('closed', 1, '2026-07-02', { user_id: 'u1', account_id: 'a1' }),
    trade('closed', 1, '2026-07-03', { user_id: 'u2', account_id: 'a2' }),
    trade('open', null, '2026-07-04', { user_id: 'u2', account_id: 'a3' }),
    trade('closed', 1, '2026-07-05', { user_id: 'u3', account_id: 'a4', is_test: true }),
  ]));
  assert.match(t, /^JUILLET 2026 Tous les traders de l'espace · 2 traders · 3 comptes \+2\.00 R/, 'periode en tete, puis le perimetre');
  // Temoin : periode vide, le perimetre reste dit, sans compte invente.
  const vide = texte(panneau(ctx, []));
  assert.match(vide, /^JUILLET 2026 Tous les traders de l'espace Aucun trade clos sur juillet 2026$/);
});

// ─── AJOUT 5 : choisir une annee affiche cette annee, pas tout l historique ───
test('periode : choisir 2025 selectionne ses 12 mois, libelle « ANNÉE 2025 »', () => {
  const ctx = charger({ maintenant: new Date('2026-10-21T10:00:00+02:00'), muet: true });
  lire(ctx, 'S').trades = [
    trade('closed', 2, '2025-03-10'),
    trade('closed', 1.5, '2026-09-15'),
    trade('closed', -1, '2026-10-02'),
  ];
  ctx.onDashYearChange('2025');
  assert.equal(lire(ctx, 'S_dashYear'), 2025);
  assert.equal(lire(ctx, 'S_dashMonths.size'), 12);
  const t = texte(ctx.__el('stats-row').innerHTML);
  assert.match(t, /^ANNÉE 2025 /, 'temoin positif : le panneau est rendu');
  assert.match(t, /\+2\.00 R/, 'seul le trade de 2025');
  assert.doesNotMatch(t, /ALL TIME/);
  // Temoin : 2026 donne ses propres chiffres.
  ctx.onDashYearChange('2026');
  const t26 = texte(ctx.__el('stats-row').innerHTML);
  assert.match(t26, /^ANNÉE 2026 .*\+0\.50 R/);
  // Une annee vide le dit en toutes lettres.
  ctx.onDashYearChange('2024');
  assert.match(texte(ctx.__el('stats-row').innerHTML), /Aucun trade clos sur l(&#39;|')année 2024/);
  assert.deepEqual(ctx.__console.filter((l) => l[0] === 'error'), [], 'aucune erreur de rendu');
});

test('total R nul : ni « + » ni vert, meme avec le bruit des flottants', () => {
  const ctx = charger();
  const html = panneau(ctx, [trade('closed', 0.3, '2026-07-02'), trade('closed', -0.1, '2026-07-03'), trade('closed', -0.2, '2026-07-04')]);
  assert.match(html, /class="stat-rr "[^>]*>0\.00<span/, 'temoin positif : le total est rendu, neutre');
  assert.doesNotMatch(texte(html), /[+-]0\.00 R/);
  // Temoin : un total positif garde son signe et sa couleur.
  assert.match(panneau(ctx, [trade('closed', 0.3, '2026-07-02')]), /class="stat-rr pos"[^>]*>\+0\.30<span/);
});

// ─── Revue v=6 : après le choix d'une année, cliquer ou glisser sur les mois marche ───
// Vrais gestionnaires des boutons de mois (buildDashMonthBtns), capturés par le faux document.
function tableauMois() {
  const ctx = charger({ maintenant: new Date('2026-10-21T10:00:00+02:00'), muet: true });
  const doc = ctx.document, orig = doc.createElement, docL = {};
  doc.createElement = (tag) => { const el = orig(tag); el.__l = {}; el.addEventListener = (t, f) => { el.__l[t] = f; }; return el; };
  doc.addEventListener = (t, f) => { (docL[t] ||= []).push(f); };
  const tr = (rr, date, id) => ({ id, status: 'closed', actual_rr: rr, trade_date: date, created_at: date + 'T10:00:00Z', instrument: 'EURUSD', direction: 'LONG', is_test: false });
  lire(ctx, 'S').trades = [tr(1.5, '2025-03-10', 'm1'), tr(2, '2025-04-10', 'm2'), tr(-1, '2025-07-10', 'm3')];
  const boutons = () => ctx.__el('dash-month-btns').children.slice(-12);
  const panneau = () => ctx.__el('stats-row').innerHTML.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const lacher = () => (docL.mouseup || []).forEach((f) => f({}));
  const appui = (i, shiftKey = false) => boutons()[i].__l.mousedown({ shiftKey, preventDefault() {} });
  return { ctx, boutons, panneau, lacher, appui };
}
test('période choisie au sélecteur, puis clic sur un mois : ce mois seul ; glisser : la plage ; Maj : retirer de l année', () => {
  let t = tableauMois();
  t.ctx.onDashYearChange('2025');
  assert.match(t.panneau(), /^ANNÉE 2025/, 'témoin : l année entière est affichée');
  t.appui(2); t.lacher();
  assert.match(t.panneau(), /^MARS 2025 .*\+1\.50 R/, 'clic sur MAR : mars seul');
  t = tableauMois();
  t.ctx.onDashYearChange('2025');
  t.appui(2); for (const i of [3, 4]) t.boutons()[i].__l.mouseover({ buttons: 1 }); t.lacher();
  assert.match(t.panneau(), /^3 MOIS SÉLECTIONNÉS .*\+3\.50 R/, 'glisser MAR→MAI : la plage');
  t = tableauMois();
  t.ctx.onDashYearChange('2025');
  t.appui(6, true); t.lacher();
  assert.match(t.panneau(), /^11 MOIS SÉLECTIONNÉS .*\+3\.50 R/, 'Maj+clic sur JUIL : l année sans juillet');
});

// ─── Revue v=6 : signe et couleur du total R pris sur la valeur AFFICHÉE ───
function totalRAffiche(rrs) {
  const ctx = charger({ maintenant: new Date('2026-10-21T10:00:00+02:00') });
  const trades = rrs.map((rr, i) => ({ id: 'z' + i, status: 'closed', actual_rr: rr, trade_date: '2026-07-0' + (i + 1), created_at: '2026-07-01T10:00:00Z', instrument: 'EURUSD', direction: 'LONG', is_test: false }));
  ctx.renderStatsPanel(ctx.calcStats(trades), 'JUILLET 2026', 'juillet 2026');
  const html = ctx.__el('stats-row').innerHTML;
  const m = /<div class="stat-rr([^"]*)"[^>]*>([^<]*)</.exec(html);
  return { total: [m && m[1].trim(), m && m[2].trim()], html };
}
test('total R : « 0.00 » neutre quand l arrondi donne 0 (jamais « +0.00 » vert ni « -0.00 » rouge)', () => {
  assert.deepEqual(totalRAffiche([1.5]).total, ['pos', '+1.50'], 'témoin : un vrai gain reste vert et signé');
  assert.deepEqual(totalRAffiche([-1.25]).total, ['neg', '-1.25'], 'témoin : une vraie perte reste rouge');
  assert.deepEqual(totalRAffiche([1.333, -1.33]).total, ['', '0.00']);
  assert.deepEqual(totalRAffiche([-0.004]).total, ['', '0.00']);
  const moy = totalRAffiche([0.004, -0.004]).html.replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(moy, /[+-]0\.00/, 'RR moyens gagné/perdu : ni « +0.00 » ni « -0.00 »');
});
