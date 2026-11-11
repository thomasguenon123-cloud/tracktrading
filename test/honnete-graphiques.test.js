'use strict';
// v=6 — Données honnêtes, graphiques du tableau de bord (courbe « R cumulé » et
// barres « R réalisé par trade »). Chaque garde APPELLE le dessin (redessinerGraphiques,
// renderCharts…) avec le Chart.js factice et porte un témoin positif : un graphique
// vide ou absent ne doit pas passer.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire, ChartFactice, horsContexte, SOURCE_HTML } = require('./charger-app.js');

const MAINTENANT = new Date('2026-10-20T12:00:00+02:00');

function trade(id, statut, rr, date, extra = {}) {
  return {
    id, status: statut, actual_rr: rr, trade_date: date, created_at: date + 'T09:00:00Z',
    instrument: 'EURUSD', direction: 'LONG', is_test: false, ...extra,
  };
}

// Dessine les graphiques du filtre courant (mois « AAAA-M » facultatif) et rend
// les deux graphiques construits par CE dessin.
function dessiner(trades, mois) {
  const ctx = charger({ maintenant: MAINTENANT });
  lire(ctx, 'S').trades = trades;
  if (mois) lire(ctx, `S_dashMonths.add('${mois}')`);
  const avant = ChartFactice.instances.length;
  ctx.redessinerGraphiques();
  const nouveaux = ChartFactice.instances.slice(avant);
  return {
    ctx,
    courbe: nouveaux.find((c) => c.config.type === 'line'),
    barres: nouveaux.find((c) => c.config.type === 'bar'),
  };
}
const donnees = (g) => horsContexte(g.config.data.datasets[0].data);
const ids = (ctx) => horsContexte(lire(ctx, 'S')._rrChartTrades.map((t) => t.id));

// Arbitrages du 20/10/2026 : un clos sans R saisi est MIS À PART (ni BE, ni tracé) ;
// les trades de test ne sont pas comptés ; un BE saisi (0) reste un palier.
const MELANGE = [
  trade('gain', 'closed', 1.5, '2026-10-02'),
  trade('sansR', 'closed', null, '2026-10-03'),
  trade('vide', 'closed', '', '2026-10-04'),
  trade('be', 'closed', 0, '2026-10-05'),
  trade('test', 'closed', -1, '2026-10-06', { is_test: true }),
  trade('annule', 'cancelled', 3, '2026-10-07'),
  trade('ouvert', 'open', null, '2026-10-08'),
];

for (const [vue, mois] of [['ALL TIME', null], ['mois sélectionné', '2026-9']]) {
  test(`graphiques (${vue}) : seuls les trades comptés, clos AVEC un R saisi, sont tracés`, () => {
    const { ctx, courbe, barres } = dessiner(MELANGE, mois);
    assert.ok(courbe && barres, 'témoin : les deux graphiques sont dessinés');
    assert.deepEqual(donnees(courbe), [0, 1.5, 1.5], 'courbe : gain puis palier du BE, rien d autre');
    assert.deepEqual(donnees(barres), [1.5, 0], 'barres : le gain et le BE');
    assert.deepEqual(ids(ctx), ['gain', 'be'], 'le clic d une barre ouvre le bon trade');
  });
}

test('buildTradesForRRChart : même liste que la courbe, sur toute période ou par mois', () => {
  const ctx = charger({ maintenant: MAINTENANT });
  lire(ctx, 'S').trades = [...MELANGE, trade('sept', 'closed', 2, '2026-09-30')].reverse();
  assert.deepEqual(horsContexte(ctx.buildTradesForRRChart(null).map((t) => t.id)), ['sept', 'gain', 'be']);
  assert.deepEqual(horsContexte(ctx.buildTradesForRRChart(['2026-9']).map((t) => t.id)), ['gain', 'be']);
});

test('graphiques : un BE saisi (0) reste tracé, en jaune ; un R non saisi n est jamais un BE', () => {
  const { courbe, barres } = dessiner([
    trade('a', 'closed', 2, '2026-10-02'),
    trade('b', 'closed', null, '2026-10-03'),
  ]);
  assert.deepEqual(donnees(courbe), [0, 2], 'témoin : le trade saisi est tracé');
  assert.deepEqual(donnees(barres), [2], 'aucune barre « BE » pour un R non saisi');
  const be = dessiner([trade('a', 'closed', 0, '2026-10-02')]);
  assert.deepEqual(donnees(be.barres), [0]);
  assert.match(be.barres.config.data.datasets[0].backgroundColor[0], /240,192,64/, 'BE en jaune');
});

test('courbe : cumul exact, arrondi seulement à l affichage (fin de courbe = total du panneau)', () => {
  const quarts = [1, 2, 3, 4].map((i) => trade('q' + i, 'closed', 0.125, `2026-10-0${i}`));
  const { courbe, barres } = dessiner(quarts);
  assert.deepEqual(donnees(courbe), [0, 0.13, 0.25, 0.38, 0.5], 'avant : 0.52 au lieu de 0.5');
  assert.deepEqual(donnees(barres), [0.125, 0.125, 0.125, 0.125], 'barres : valeur saisie exacte');
});

test('barres : la couleur suit la valeur saisie exacte (0.004 R est un gain, pas un BE)', () => {
  const { barres } = dessiner([trade('a', 'closed', 0.004, '2026-10-02'), trade('b', 'closed', -0.004, '2026-10-03')]);
  const c = horsContexte(barres.config.data.datasets[0].backgroundColor);
  assert.match(c[0], /0,214,143/, 'gain en vert');
  assert.match(c[1], /255,77,106/, 'perte en rouge');
});

const infobulle = (g) => g.config.options.plugins.tooltip.callbacks;

test('courbe : axe X par trade (jj/mm), info-bulle « Cumulé » qui nomme le trade', () => {
  const { courbe } = dessiner([
    trade('a', 'closed', 1, '2026-10-02', { instrument: 'GBPUSD' }),
    trade('b', 'closed', 1, '2026-10-05'),
  ]);
  assert.deepEqual(horsContexte(courbe.config.data.labels), ['Début', '02/10', '05/10'], 'avant : « oct. 26 » répété');
  const cb = infobulle(courbe);
  assert.equal(cb.title([{ dataIndex: 2 }]), 'EURUSD · 05/10/26');
  assert.equal(cb.title([{ dataIndex: 1 }]), 'GBPUSD · 02/10/26');
  assert.equal(cb.title([{ dataIndex: 0 }]), 'Début');
  assert.equal(cb.label({ parsed: { y: 2 }, dataIndex: 2 }), 'Cumulé : +2.00 R');
  assert.equal(cb.afterLabel({ parsed: { y: 2 }, dataIndex: 2 }), 'Ce trade : +1.00 R');
  assert.equal(cb.label({ parsed: { y: -0.001 }, dataIndex: 0 }), 'Cumulé : 0.00 R', 'jamais « -0.00 »');
});

test('axes X : l année apparaît quand la période couvre plusieurs années', () => {
  const { courbe, barres } = dessiner([trade('a', 'closed', 1, '2025-10-10'), trade('b', 'closed', 1, '2026-10-01')]);
  assert.deepEqual(horsContexte(courbe.config.data.labels), ['Début', '10/10/25', '01/10/26']);
  assert.deepEqual(horsContexte(barres.config.data.labels), ['10/10/25 EURUSD', '01/10/26 EURUSD']);
  const un = dessiner([trade('a', 'closed', 1, '2026-10-10')]);
  assert.deepEqual(horsContexte(un.barres.config.data.labels), ['10/10 EURUSD'], 'témoin : une seule année, jj/mm');
});

test('barres : un BE est visible et cliquable, son info-bulle dit « BE »', () => {
  const { barres } = dessiner([trade('a', 'closed', 0, '2026-10-02'), trade('b', 'closed', -1.5, '2026-10-03')]);
  assert.ok(barres.config.data.datasets[0].minBarLength > 0, 'une barre à 0 R garde une hauteur');
  const cb = infobulle(barres);
  assert.equal(cb.label({ parsed: { y: 0 } }), '0.00 R (BE)');
  assert.equal(cb.label({ parsed: { y: -1.5 } }), '-1.50 R', 'témoin : une perte reste une perte');
  assert.equal(cb.title([{ dataIndex: 1, label: '' }]), 'EURUSD · 03/10/26');
});

test('courbe : pas de lissage (un BE reste un palier plat, aucun pic inventé)', () => {
  const { courbe } = dessiner([trade('a', 'closed', 1.5, '2026-10-02'), trade('b', 'closed', 0, '2026-10-03')]);
  const ds = courbe.config.data.datasets[0];
  assert.deepEqual(horsContexte(ds.data), [0, 1.5, 1.5], 'témoin : la courbe est dessinée');
  assert.equal(ds.tension, 0);
});

test('axes Y : graduations exactes (ni « +0.1R » répété, ni 0.25 sur « +0.3R », ni « -0.0R »)', () => {
  const { courbe, barres } = dessiner([trade('a', 'closed', 0.25, '2026-10-02')]);
  for (const g of [courbe, barres]) {
    const f = g.config.options.scales.y.ticks.callback;
    const pas = [0.05, 0.1, 0.15, 0.2, 0.25].map((v) => f(v));
    assert.deepEqual(pas, ['+0.05R', '+0.1R', '+0.15R', '+0.2R', '+0.25R']);
    assert.equal(f(0), '0R');
    assert.equal(f(-0.04), '-0.04R');
    assert.equal(f(0.1 + 0.2), '+0.3R', 'pas de bruit de virgule flottante');
    assert.equal(f(-2), '-2R');
  }
});

test('index.html : en-têtes des graphiques honnêtes (R, pas « Account Balance » ni « R:R »)', () => {
  const lbl = [...SOURCE_HTML.matchAll(/<span class="chart-lbl">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.equal(lbl.length, 2, 'témoin : les deux en-têtes sont trouvés');
  assert.ok(lbl.includes('R cumulé — trades clos'), lbl.join(' | '));
  assert.ok(lbl.some((l) => l.startsWith('R réalisé par trade')), lbl.join(' | '));
  assert.ok(!lbl.some((l) => /Account Balance|R:R/.test(l)), lbl.join(' | '));
});

// Le faux document rend null pour querySelector : on lui apprend à chercher parmi
// les enfants ajoutés, comme le navigateur.
function cadre(ctx, id) {
  const el = ctx.__el(id);
  el.querySelector = (sel) => el.children.find((c) => c.classList && c.classList.contains(sel.replace('.', ''))) || null;
  return el;
}
const message = (el) => el.children.find((c) => c.classList && c.classList.contains('chart-vide'));

test('rien à tracer : graphiques détruits et une phrase dans leur cadre, canvas gardé pour la suite', () => {
  const { ctx, courbe, barres } = dessiner([trade('a', 'closed', 1, '2026-10-02')]);
  const bal = cadre(ctx, 'bal-wrap');
  const rr = cadre(ctx, 'rr-wrap');
  assert.ok(courbe && barres, 'témoin : avec un trade saisi, les graphiques sont dessinés');
  assert.equal(message(bal), undefined, 'témoin : pas de message quand il y a un tracé');
  const S = lire(ctx, 'S');
  const detruits = [];
  // Comme Chart.js : destroy() rend au canvas son style d'origine (display compris).
  S.chartBal.destroy = () => { detruits.push('courbe'); ctx.__el('balChart').style.display = ''; };
  S.chartRR.destroy = () => { detruits.push('barres'); ctx.__el('rrChart').style.display = ''; };

  // Période sans trade clos avec un R : un ouvert, un clos sans R, un trade de test.
  S.trades = [trade('o', 'open', null, '2026-10-03'), trade('n', 'closed', null, '2026-10-04'),
    trade('t', 'closed', 2, '2026-10-05', { is_test: true })];
  const avant = ChartFactice.instances.length;
  ctx.redessinerGraphiques();
  assert.equal(ChartFactice.instances.length, avant, 'aucun axe vide dessiné autour de 0');
  assert.deepEqual(detruits.sort(), ['barres', 'courbe']);
  assert.equal(S.chartBal, null);
  assert.equal(S.chartRR, null);
  assert.deepEqual(horsContexte(S._rrChartTrades), [], 'un ancien clic ne peut plus ouvrir un trade');
  for (const [el, canvas] of [[bal, 'balChart'], [rr, 'rrChart']]) {
    const m = message(el);
    assert.ok(m, 'message posé dans ' + el.id);
    assert.equal(m.textContent, 'Aucun trade clos avec un R saisi sur la période');
    assert.notEqual(m.style.display, 'none');
    assert.equal(ctx.__el(canvas).style.display, 'none', 'canvas masqué, pas supprimé');
  }

  // Un trade saisi revient : même canvas, message masqué, graphiques redessinés.
  S.trades = [trade('a', 'closed', -1, '2026-10-02')];
  ctx.redessinerGraphiques();
  assert.equal(ChartFactice.instances.length, avant + 2, 'courbe et barres redessinées');
  assert.equal(ChartFactice.instances.at(-1).canvas, ctx.__el('rrChart'), 'le canvas d origine est réutilisé');
  for (const [el, canvas] of [[bal, 'balChart'], [rr, 'rrChart']]) {
    assert.equal(el.children.filter((c) => c.classList && c.classList.contains('chart-vide')).length, 1, 'un seul message');
    assert.equal(message(el).style.display, 'none');
    assert.equal(ctx.__el(canvas).style.display, '');
  }
});

test('changement de thème : chaque barre garde la couleur de SON trade (pas un total mensuel)', async () => {
  const { ctx, barres } = dessiner([
    trade('be', 'closed', 0, '2026-09-10'), trade('p1', 'closed', -1, '2026-09-20'),
    trade('p2', 'closed', -1, '2026-10-02'), trade('g', 'closed', 3, '2026-10-05'),
  ]);
  const couleurs = (g) => horsContexte(g.data.datasets[0].backgroundColor).map((c) => (/240,192,64/.test(c) ? 'jaune' : /0,214,143/.test(c) ? 'vert' : /255,77,106/.test(c) ? 'rouge' : c));
  assert.deepEqual(couleurs(barres), ['jaune', 'rouge', 'rouge', 'vert'], 'témoin : couleurs du premier dessin');
  // Nouveau thème : le harnais rend '' pour toutes les variables CSS, on lui en donne.
  const THEME = { '--chart-grid': 'GRILLE-CLAIRE', '--chart-bar-p': 'BARRE-P', '--chart-bar-n': 'BARRE-N', '--chart-fill': 'APLAT' };
  ctx.getComputedStyle = () => ({ getPropertyValue: (v) => THEME[v] || '' });
  const S = lire(ctx, 'S');
  S.authUser = { id: 'u-fictif' };
  await ctx.toggleUserTheme();
  assert.deepEqual(couleurs(S.chartRR), ['jaune', 'rouge', 'rouge', 'vert'], 'une perte reste rouge, le BE reste jaune');
  assert.equal(S.chartRR.options.scales.y.grid.color, 'GRILLE-CLAIRE', 'la grille suit le nouveau thème');
  assert.notEqual(S.chartBal.data.datasets[0].backgroundColor, 'APLAT', 'le dégradé de la courbe est gardé');
});

test('changement de thème sans graphique affiché : Chart.js n est pas chargé pour rien', () => {
  const ctx = charger({ sansChart: true });
  ctx.updateChartColors();
  assert.equal(ctx.document.head.children.length, 0, 'aucun <script> ajouté');
  ctx.redessinerGraphiques();
  assert.equal(ctx.document.head.children.length, 1, 'témoin : un vrai dessin demande bien Chart.js');
});
