'use strict';
// v=6 (revue adverse) — zone connexion / démarrage / lectures / toasts / espaces / admin.
// Chaque test ÉCHOUE sur l'intégration s'il y a défaut ; chacun porte un témoin positif.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire, faireDb } = require('./charger-app.js');

const tour = () => new Promise((r) => setImmediate(r));
async function laisserFiler(n = 8) { for (let i = 0; i < n; i++) await tour(); }

const MAISON = { id: 'ws-maison', name: 'Maison', is_shared: false };
const EQUIPE = { id: 'ws-equipe', name: 'Equipe', is_shared: true };
const CLUB = { id: 'ws-club', name: 'Club', is_shared: true };
const PANNE = { data: null, error: { message: 'TypeError: Failed to fetch' } };
function espace(ctx, extra = {}) {
  Object.assign(lire(ctx, 'S'), {
    workspaceId: MAISON.id, workspace: MAISON, currentWorkspaceId: MAISON.id, currentWorkspace: MAISON,
    availableWorkspaces: [MAISON, EQUIPE, CLUB], isSuperAdmin: true,
    users: [{ id: 'u-m', name: 'Trader Maison' }],
    accounts: [{ id: 'acc-m', name: 'Compte Maison', balance: 10000, currency: 'USD' }],
    trades: [{ id: 't-m', instrument: 'EURUSD', direction: 'LONG', status: 'closed', actual_rr: 1, trade_date: '2026-11-02', is_test: false }],
    ...extra,
  });
  lire(ctx, "['trades', 'users', 'accounts'].forEach((k) => _lus.add(k))");
}
// Réponse « en attente » : le test la libère quand il veut (base à guichet ciblée).
function guichet() {
  let liberer;
  const p = new Promise((ok) => { liberer = ok; });
  return { p, liberer: (r) => liberer(r) };
}
const filtre = (etat, col) => (etat.filtres.find((f) => f[1] === col) || [])[2];

// ─── C. Changement d'espace en échec pendant une saisie du rapport ───
test('C — changement d espace en échec pendant une saisie du rapport : la saisie part dans son espace (ou sa perte est dite), l indicateur ne reste pas « En cours… »', async () => {
  const usersEquipe = guichet();
  const db = faireDb({ reponses: {
    users: (e) => (filtre(e, 'workspace_id') === EQUIPE.id ? usersEquipe.p : { data: [{ id: 'u-m', name: 'Trader Maison' }], error: null }),
    currency_reports: { data: null, error: null }, // semaine encore vide dans chaque espace
  } });
  const ctx = charger({ db, muet: true });
  espace(ctx);
  ctx.__el('sec-currency').classList.add('active'); // onglet Rapports ouvert
  ctx.__el('rpt-week').value = '2026-11-09';
  const notes = ctx.__creer('cnotes-USD');
  const fin = ctx.switchCurrentWorkspace(EQUIPE.id); // ex. bandeau / badge depuis Rapports
  await laisserFiler();
  assert.equal(lire(ctx, 'S._rptCharge'), true, 'témoin : le rapport d Equipe est chargé et éditable pendant le chargement des trades');
  assert.equal(lire(ctx, 'S._rptWs'), EQUIPE.id);
  // L'utilisateur tape dans le rapport affiché (moins d'1 s avant la fin : l'auto-save n'est pas parti).
  notes.innerHTML = 'Biais haussier sur USD';
  ctx.onNotesInput('USD', notes);
  assert.equal(ctx.__el('autosave-indicator').className, 'saving', 'témoin : « ● En cours… »');
  usersEquipe.liberer(PANNE); // la lecture des traders d'Equipe échoue
  await fin; await laisserFiler();
  assert.equal(lire(ctx, 'S.currentWorkspaceId'), MAISON.id, 'témoin : retour à Maison');
  const ecrit = db.appels.some((a) => a.table === 'currency_report_entries' && JSON.stringify(a.charge).includes('Biais haussier'));
  const dit = /saisie|rapport/i.test(ctx.__el('toast').textContent);
  const ind = ctx.__el('autosave-indicator');
  assert.ok(ecrit || dit, 'la saisie doit être enregistrée (dans Equipe) ou sa perte dite ; toast : « ' + ctx.__el('toast').textContent +
    ' » ; écritures : ' + db.appels.length + ' ; indicateur : ' + ind.className + ' « ' + ind.textContent + ' »');
  assert.notEqual(ctx.__el('autosave-indicator').className, 'saving', 'l indicateur ne doit pas rester « ● En cours… » (et la fermeture de page demander confirmation) alors que rien ne s enregistre');
});

// ─── D. Changement d'espace refusé (saisie non enregistrée) puis « Annuler » ───
test('D — Admin, saisie du rapport non enregistrée, nouvel espace choisi puis « Annuler » : le sélecteur « Vue active » revient sur l espace affiché', async () => {
  const db = faireDb({ reponses: { currency_reports: PANNE } }); // l'enregistrement de la saisie échoue (réseau)
  const ctx = charger({ db, muet: true });
  espace(ctx);
  lire(ctx, "Object.assign(S,{_rptCharge:true,_rptSemaine:'2026-11-09',_rptWs:'ws-maison',_currentRptId:null}); window._curNotesCache={USD:'Saisie non enregistrée'}; window._curBiasCache={}; window._curLastSaved={}");
  const sel = ctx.__el('admin-ws-selector');
  sel.value = EQUIPE.id; // le navigateur a déjà changé la valeur quand onchange part
  await ctx.switchCurrentWorkspace(sel.value);
  assert.equal(ctx.__el('confirm-title').textContent, 'Saisie non enregistrée', 'témoin : la confirmation d abandon est proposée');
  ctx.closeConfirm(); // « Annuler » : garder la saisie, rester sur Maison
  assert.equal(lire(ctx, 'S.currentWorkspaceId'), MAISON.id, 'témoin : la vue n a pas changé (« Rien n a changé »)');
  assert.equal(sel.value, MAISON.id, 'le sélecteur « Vue active » doit revenir sur Maison (il affiche Equipe, et re-choisir Equipe ne déclenche plus onchange)');
});

// ─── E. Deux changements d'espace rapprochés : la remise en place mélange trois espaces ───
test('E — Admin choisit Equipe puis Club pendant le chargement : un seul changement à la fois, jamais trois espaces mêlés sous un ✅', async () => {
  const g = { usersE: guichet(), accE: guichet(), usersC: guichet(), accC: guichet(), tradesC: guichet() };
  const db = faireDb({ reponses: {
    users: (e) => ({ [EQUIPE.id]: g.usersE.p, [CLUB.id]: g.usersC.p })[filtre(e, 'workspace_id')] || { data: [], error: null },
    accounts: (e) => ({ [EQUIPE.id]: g.accE.p, [CLUB.id]: g.accC.p })[filtre(e, 'workspace_id')] || { data: [], error: null },
    trades: (e) => (filtre(e, 'workspace_id') === CLUB.id ? g.tradesC.p : { data: [{ id: 't-e', instrument: 'GBPUSD', direction: 'SHORT', status: 'closed', actual_rr: 2, trade_date: '2026-11-03', is_test: false }], error: null }),
  } });
  const ctx = charger({ db, muet: true });
  espace(ctx);
  const vers = [];
  const vrai = ctx.toast; ctx.toast = (m, t = 'ok') => { vers.push(t + ' | ' + m); return vrai(m, t); };
  const choixE = ctx.switchCurrentWorkspace(EQUIPE.id);
  await laisserFiler();
  const choixC = ctx.switchCurrentWorkspace(CLUB.id); // réseau lent : l'admin corrige son choix
  await laisserFiler();
  g.usersE.liberer({ data: [{ id: 'u-e', name: 'Trader Equipe' }], error: null });
  g.accE.liberer({ data: [{ id: 'acc-e', name: 'Compte Equipe', balance: 5000, currency: 'USD' }], error: null });
  await laisserFiler(); // Equipe poursuit : ses trades sont demandés… pour la vue courante (Club)
  g.usersC.liberer(PANNE); // Club échoue → remise en place de la photo prise en plein changement
  g.accC.liberer({ data: [], error: null });
  await choixC; await laisserFiler();
  g.tradesC.liberer({ data: [{ id: 't-c', instrument: 'XAUUSD', direction: 'LONG', status: 'closed', actual_rr: -1, trade_date: '2026-11-04', is_test: false }], error: null });
  await choixE; await laisserFiler();
  const S = lire(ctx, 'S');
  assert.ok(vers.includes('ok | Vue : Equipe ✅'), 'témoin : le changement vers Equipe s annonce réussi');
  assert.equal(S.currentWorkspaceId, EQUIPE.id, 'témoin : vue Equipe');
  const espaces = new Set([S.users[0]?.id, S.accounts[0]?.id, S.trades[0]?.id].map((id) => id && id.split('-')[1]));
  assert.deepEqual([...espaces], ['e'], 'traders, comptes et trades doivent tous être ceux d Equipe ; obtenu : ' +
    JSON.stringify({ traders: S.users.map((u) => u.name), comptes: S.accounts.map((a) => a.name), trades: S.trades.map((t) => t.instrument) }));
});
