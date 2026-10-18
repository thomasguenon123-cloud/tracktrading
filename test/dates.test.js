'use strict';
// Gardes "une date n'est pas un instant" (brief 3.1) : a Paris, a 0 h 30 en
// ete, la date du jour est encore la veille en UTC. Toute lecture de la date
// du jour doit se faire en heure locale (fmtYMD / fmtYM), jamais par
// toISOString().slice(0, 10).
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire } = require('./charger-app.js');

// Jeudi 2 juillet 2026, 00:30 a Paris = mercredi 1er juillet, 22:30 UTC.
const NUIT_ETE = new Date('2026-07-01T22:30:00Z');

test('le fuseau du test est bien Paris (heure d ete)', () => {
  assert.equal(NUIT_ETE.getDate(), 2);
  assert.equal(NUIT_ETE.getHours(), 0);
});

test('fmtYMD / fmtYM lisent la date locale', () => {
  const ctx = charger({ maintenant: NUIT_ETE });
  assert.equal(ctx.fmtYMD(new ctx.Date()), '2026-07-02');
  assert.equal(ctx.fmtYM(new ctx.Date()), '2026-07');
});

test('le mois des rapports au demarrage est le mois local', () => {
  const ctx = charger({ maintenant: new Date('2026-06-30T22:30:00Z') }); // 1er juillet 00:30
  assert.equal(lire(ctx, 'S_rptMonth'), '2026-07');
});

test('Nouveau Trade propose la date locale du jour', async () => {
  const ctx = charger({ maintenant: NUIT_ETE });
  await ctx.openTrade();
  assert.equal(ctx.__el('m-date').value, '2026-07-02');
});

test('la semaine des rapports commence le lundi local', () => {
  const ctx = charger({ maintenant: NUIT_ETE });
  ctx.initCurrencyWeek();
  assert.equal(ctx.__el('rpt-week').value, '2026-06-29');
});

test('les lundis d un mois sont calcules en local', () => {
  const ctx = charger({ maintenant: NUIT_ETE });
  const lundis = Array.from(ctx.getMondaysInMonth(2026, 5)).map((d) => ctx.fmtYMD(d));
  assert.deepEqual(lundis, ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']);
});

test('le calendrier economique demande la semaine locale (lundi -> dimanche)', () => {
  const ctx = charger({ maintenant: NUIT_ETE });
  const url = ctx.buildCalIframeSrc();
  assert.match(url, /dateFrom=2026-06-29/);
  assert.match(url, /dateTo=2026-07-05/);
});
