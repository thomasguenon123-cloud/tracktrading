'use strict';
// Gardes d'ecran : chaque test APPELLE la fonction de rendu (une garde qui ne
// lit que le source ne voit pas une ReferenceError) et exige un temoin
// positif (un rendu vide ne doit pas passer).
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire, faireDb } = require('./charger-app.js');

// Marqueur inerte (aucun script) : s'il devient une balise, le champ n'est pas echappe.
const PIEGE = '"><tt-xss data-champ="test"></tt-xss>';

function tradeFictif(extra = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111', status: 'closed', direction: 'LONG',
    instrument: 'EURUSD', strategy: 'Order Block', trade_date: '2026-07-02', created_at: '2026-07-02T08:00:00Z',
    actual_rr: 1.5, pnl_amount: 150, entry_price: 1.0842, sl_price: 1.0798, tp_price: 1.093,
    session: 'London', timeframe: 'H4', setup_type: 'OB', execution_quality: 8, plan_respected: 'respected',
    entry_notes: 'Entree propre', management_notes: 'BE apres +1R', lessons: 'Patience',
    analysis_notes: 'Confluence H4', users: { name: 'Trader Fictif', color: '#4da6ff' }, is_test: false,
    ...extra,
  };
}

test('panneau de statistiques : rendu avec les chiffres', () => {
  const ctx = charger();
  const st = ctx.calcStats([tradeFictif(), tradeFictif({ id: 't2', actual_rr: -1, pnl_amount: -100 })]);
  ctx.renderStatsPanel(st, 'JUILLET 2026');
  const html = ctx.__el('stats-row').innerHTML;
  assert.match(html, /JUILLET 2026/);
  assert.match(html, /\+0\.50/, 'R cumule (+1,5 - 1)');
  assert.match(html, />50<span/, 'taux de reussite 50 %');
});

test('journal : chaque trade est rendu', () => {
  const ctx = charger();
  const S = lire(ctx, 'S');
  S.filtered = [tradeFictif(), tradeFictif({ id: 't2', instrument: 'GBPJPY', status: 'open' })];
  ctx.renderJournal();
  const html = ctx.__el('j-list').innerHTML;
  assert.match(html, /EURUSD/);
  assert.match(html, /GBPJPY/);
  assert.match(html, /Clôturer ce trade rapidement/, 'un trade ouvert propose la cloture rapide');
});

test('journal vide : un etat vide explicite', () => {
  const ctx = charger();
  lire(ctx, 'S').filtered = [];
  ctx.renderJournal();
  assert.match(ctx.__el('j-list').innerHTML, /Aucun trade/);
});

test('journal : les champs de texte libre sont echappes (XSS)', () => {
  const ctx = charger();
  lire(ctx, 'S').filtered = [tradeFictif({
    instrument: 'EUR' + PIEGE, strategy: PIEGE, entry_notes: PIEGE, management_notes: PIEGE,
    lessons: PIEGE, analysis_notes: PIEGE, setup_type: PIEGE, users: { name: PIEGE, color: '#4da6ff' },
  })];
  ctx.renderJournal();
  const html = ctx.__el('j-list').innerHTML;
  assert.match(html, /EUR(&quot;|")&gt;&lt;tt-xss/, 'temoin positif : l instrument piege est rendu, echappe');
  assert.ok(!html.includes('<tt-xss'), 'aucune balise injectee ne doit survivre');
});

test('detail d un trade (clic sur une barre) : rendu', async () => {
  const ctx = charger();
  const t = tradeFictif();
  lire(ctx, 'S').trades = [t];
  await ctx.showTradeDetailById(t.id);
  assert.match(ctx.__el('tjp-title').innerHTML, /EURUSD/);
  assert.match(ctx.__el('tjp-content').innerHTML, /Modifier ce trade/);
});

test('rapports : vue devise et vue bilan', () => {
  const ctx = charger();
  ctx.renderCurrencyView();
  const devise = ctx.__el('cur-single-view').innerHTML;
  assert.match(devise, /id="cnotes-USD"/);
  assert.match(devise, /Politique Monétaire/);
  ctx.renderBilanView();
  const bilan = ctx.__el('cur-single-view').innerHTML;
  assert.match(bilan, /Bilan de la semaine/);
  assert.equal((bilan.match(/class="bilan-img-block"/g) || []).length, 4, 'quatre zones de capture');
});

test('macro : graphique et historique', () => {
  const ctx = charger();
  ctx.loadMacro();
  assert.match(ctx.__el('macro-indic-title').textContent, /Inflation/);
  assert.match(ctx.__el('macro-table-wrap').innerHTML, /HISTORIQUE MENSUEL/);
  assert.ok(ctx.Chart.instances.length >= 1, 'un graphique est construit');
});

test('calendrier : barres de zones et de periodes', () => {
  const ctx = charger();
  ctx.loadCalendar();
  assert.equal(ctx.__el('cal-zone-btns').children.length, 10);
  assert.equal(ctx.__el('cal-period-btns').children.length, 3);
});

test('administration : la liste des comptes est rendue et echappee', async () => {
  const db = faireDb({
    reponses: {
      admin_list_users: { data: [
        { email: 'alice@exemple.fr', note: PIEGE, auth_user_id: null, workspace_name: 'Equipe <b>A</b>', workspace_is_shared: true, profile_name: PIEGE },
        { email: 'bob@exemple.fr', note: null, auth_user_id: '22222222-2222-4222-8222-222222222222', is_super_admin_user: true, last_sign_in_at: '2026-07-01T10:00:00Z' },
      ], error: null },
    },
  });
  const ctx = charger({ db });
  lire(ctx, 'S').isSuperAdmin = true;
  await ctx.loadAdminUsers();
  const lignes = ctx.__el('admin-users-tbody').children.map((tr) => tr.innerHTML);
  assert.equal(lignes.length, 2);
  assert.match(lignes[0], /alice@exemple\.fr/);
  assert.match(lignes[0], /En attente d'inscription/);
  assert.match(lignes[1], /Protégé/, 'un super administrateur ne peut pas etre retire');
  assert.ok(!lignes.join('').includes('<tt-xss'), 'note et nom de profil echappes');
  assert.ok(!lignes[0].includes('<b>A</b>'), 'nom d espace echappe');
});

test('bandeau d espace : mode consultation', () => {
  const ctx = charger();
  const S = lire(ctx, 'S');
  Object.assign(S, { workspaceId: 'w-maison', currentWorkspaceId: 'w-vue', workspace: { name: 'Maison' }, currentWorkspace: { name: 'Vue <i>x</i>' } });
  ctx.updateWorkspaceBanner();
  const html = ctx.__el('ws-context-msg').innerHTML;
  assert.match(html, /Mode consultation/);
  assert.ok(!html.includes('<i>x</i>'), 'nom d espace echappe');
});
