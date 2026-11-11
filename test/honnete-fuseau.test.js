'use strict';
// v=6 — Une date de trade (AAAA-MM-JJ, sans heure) se lit en heure LOCALE, même à
// l'ouest de Greenwich : lue en UTC, le trade du 01/10 tombait au 30/09 (et en
// septembre). Fichier à part : le fuseau du processus de test est New York.
process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire, horsContexte } = require('./charger-app.js');

test('New York : un trade du 01/10 reste au 01/10, et dans le mois d octobre', () => {
  assert.equal(new Date('2026-10-01').getDate(), 30, 'témoin : dans ce fuseau, la lecture UTC donne la veille');
  const ctx = charger();
  assert.equal(ctx.fDate('2026-10-01'), '01/10/26');
  const t = { id: 'x', status: 'closed', actual_rr: 1, trade_date: '2026-10-01', created_at: '2026-10-01T14:00:00Z' };
  const d = ctx.dateDuTrade(t);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getMonth(), 9);
  lire(ctx, 'S').trades = [t];
  assert.deepEqual(horsContexte(ctx.getTradesForMonths(['2026-9']).map((x) => x.id)), ['x'], 'compté en octobre');
});
