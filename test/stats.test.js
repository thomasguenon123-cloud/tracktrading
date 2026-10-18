'use strict';
// Regles de calcul du tableau de bord, telles qu'elles sont AUJOURD'HUI.
// Ces tests documentent les regles (voir le tableau "Regle -> fonction" de
// CLAUDE.md) : si Thomas en change une, le test change dans le meme commit.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire, horsContexte } = require('./charger-app.js');

function trade(id, statut, rr, date, extra = {}) {
  return { id, status: statut, actual_rr: rr, trade_date: date, created_at: date + 'T10:00:00Z', instrument: 'EURUSD', direction: 'LONG', ...extra };
}

const TRADES = [
  trade('t1', 'closed', 2, '2026-07-02', { pnl_amount: 200 }),
  trade('t2', 'closed', -1, '2026-07-03', { pnl_amount: -100 }),
  trade('t3', 'closed', 0, '2026-07-06', { pnl_amount: 0 }),
  trade('t4', 'open', null, '2026-07-07'),
  trade('t5', 'cancelled', 3, '2026-06-30'),
];

test('calcStats : gagnant R>0, perdant R<0, BE R=0, taux = gagnants / trades clos', () => {
  const ctx = charger();
  const st = horsContexte(ctx.calcStats(TRADES.filter((t) => t.status !== 'cancelled')));
  assert.equal(st.closed, 3);
  assert.equal(st.wins, 1);
  assert.equal(st.losses, 1);
  assert.equal(st.be, 1);
  assert.equal(st.totalRR, 1);
  assert.equal(st.totalPnL, 100);
  assert.ok(Math.abs(st.winRate - 100 / 3) < 1e-9, 'le BE compte au denominateur');
  assert.equal(st.avgWinRR, 2);
  assert.equal(st.avgLossRR, -1);
});

test('courbe R cumule : les trades BE restent visibles (palier plat)', () => {
  const ctx = charger();
  const { labels, data } = horsContexte(ctx.buildCumRRData(TRADES));
  assert.deepEqual(data, [0, 2, 1, 1]);
  assert.equal(labels.length, 4);
  assert.equal(labels[0], 'Début');
});

test('selection par mois : mois local, trades annules exclus', () => {
  const ctx = charger();
  lire(ctx, 'S').trades = TRADES;
  const juillet = horsContexte(ctx.getTradesForMonths(['2026-6']).map((t) => t.id));
  assert.deepEqual(juillet, ['t1', 't2', 't3', 't4']);
  const juin = horsContexte(ctx.getTradesForMonths(['2026-5']).map((t) => t.id));
  assert.deepEqual(juin, [], 'le trade annule de juin est exclu');
});

test('barres R:R : une barre par trade clos, dans l ordre des dates', () => {
  const ctx = charger();
  lire(ctx, 'S').trades = [...TRADES].reverse();
  const ids = horsContexte(ctx.buildTradesForRRChart(null).map((t) => t.id));
  assert.deepEqual(ids, ['t1', 't2', 't3']);
});
