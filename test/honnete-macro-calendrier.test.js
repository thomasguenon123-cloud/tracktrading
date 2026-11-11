'use strict';
// v=6 « donnees honnetes » — Macro et Calendrier economique.
// Chaque garde APPELLE le rendu (loadMacro, loadCalendar, onCalTzChange…) et
// porte un temoin positif (un rendu vide ne doit pas passer).
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire, injecter, horsContexte, ChartFactice, SOURCE_HTML, SOURCE_APP, sansCommentaires } = require('./charger-app.js');

// Lundi 19 octobre 2026, 10 h a Paris (heure d'ete) : l'Europe recule d'une heure
// le 25/10, les Etats-Unis le 01/11.
const LUNDI_19_OCT = new Date('2026-10-19T08:00:00Z');

// ─── Macro ───
function macro(etat, maintenant = LUNDI_19_OCT) {
  const ctx = charger({ maintenant });
  injecter(ctx, etat);
  ctx.loadMacro();
  return ctx;
}
const dernierGraphe = () => ChartFactice.instances[ChartFactice.instances.length - 1];
const infoBulle = (v, zone) => dernierGraphe().options.plugins.tooltip.callbacks.label({ parsed: { y: v }, dataset: { label: zone, zone } });

test('macro (#36) : un taux directeur garde ses 2 decimales (3.75 %, pas « 3.8 % »)', () => {
  const ctx = macro({ S_macroTab: 'rates', S_macroSub: 'policy', S_macroZone: 'USD' });
  assert.match(ctx.__el('macro-indic-latest').textContent, /: 3\.75 % \(/, 'derniere valeur saisie');
  assert.match(ctx.__el('macro-table-wrap').innerHTML, />3\.75 %</, 'historique');
  assert.match(infoBulle(3.75, 'USD'), /3\.75 %$/, 'info-bulle');
  const jpy = macro({ S_macroTab: 'rates', S_macroSub: 'policy', S_macroZone: 'JPY' });
  assert.match(jpy.__el('macro-indic-latest').textContent, /: 0\.75 % \(/);
  // Temoin : une serie saisie a 1 decimale s'affiche a l'identique.
  const cpi = macro({ S_macroTab: 'inflation', S_macroSub: 'cpi', S_macroZone: 'USD' });
  assert.match(cpi.__el('macro-indic-latest').textContent, /: 3\.8 % \(/);
  assert.match(cpi.__el('macro-table-wrap').innerHTML, />3\.7 %</);
});

// Serie mensuelle synthetique : n mois a partir de 'AAAA-MM'.
function serie(debut, n, v = 2) {
  let [a, m] = debut.split('-').map(Number);
  return Array.from({ length: n }, () => {
    const d = { d: a + '-' + String(m).padStart(2, '0'), v };
    m++; if (m > 12) { m = 1; a++; }
    return d;
  });
}
function macroAvec(donnees, etat) {
  const ctx = charger({ maintenant: LUNDI_19_OCT });
  donnees(lire(ctx, 'MACRO_DATA'));
  injecter(ctx, { S_macroTab: 'inflation', S_macroSub: 'cpi', S_macroZone: 'USD', ...etat });
  ctx.loadMacro();
  return ctx;
}
const axeX = () => Array.from(dernierGraphe().data.labels);

test('macro (#39) : « 1 an » = les 12 derniers mois, comptes depuis aujourd hui', () => {
  const ctx = macroAvec((D) => { D.USD.inflation.cpi = serie('2023-08', 39); }, { S_macroPeriod: 1 }); // 2023-08 -> 2026-10
  let x = axeX();
  assert.equal(x.length, 12, '12 mois, pas 13');
  assert.equal(x[0], 'nov. 25');
  assert.equal(x[11], 'oct. 26');
  ctx.setMacroPeriod(3);
  assert.equal(axeX().length, 36, 'temoin : 3 ans = 36 mois');
  // Donnees arretees en avril 2026 : la fenetre part d'aujourd'hui, pas de la derniere donnee.
  macroAvec((D) => { D.USD.inflation.cpi = serie('2023-05', 36); }, { S_macroPeriod: 1 }); // -> 2026-04
  x = axeX();
  assert.deepEqual([x[0], x[x.length - 1], x.length], ['nov. 25', 'avr. 26', 6]);
});

test('macro (#39) : en mode Comparer, la borne est la meme pour toutes les zones', () => {
  macroAvec((D) => {
    D.USD.inflation.cpi = serie('2025-06', 17); // -> 2026-10
    D.EUR.inflation.cpi = serie('2024-01', 16); // -> 2025-04 : hors de « 1 an »
  }, { S_macroPeriod: 1, S_macroCompare: true, S_macroCompareZones: new Set(['USD', 'EUR']) });
  const [usd, eur] = dernierGraphe().data.datasets;
  assert.equal(axeX()[0], 'nov. 25');
  assert.ok(usd.data.some((v) => v !== null), 'temoin : USD a des valeurs');
  assert.ok(eur.data.every((v) => v === null), 'EUR : aucune valeur dans la fenetre commune');
});

test('macro (#39) : periode reellement couverte, et fenetre vide ≠ « pas de donnee »', () => {
  const ctx = macro({ S_macroTab: 'inflation', S_macroSub: 'cpi', S_macroZone: 'USD' });
  assert.equal(ctx.__el('macro-couverture').textContent,
    'Sur 5 ans : 4 valeurs saisies, de janv. 26 à avr. 26 — l\'historique saisi ne couvre pas toute la période.');
  const vieux = macroAvec((D) => { D.USD.inflation.cpi = serie('2024-01', 6); }, { S_macroPeriod: 1 });
  const msg = vieux.__el('macro-error').innerHTML;
  assert.match(msg, /Aucune valeur de <strong>Inflation \(CPI\)<\/strong> sur la période choisie \(1 an\)/);
  assert.match(msg, /Dernière valeur saisie : juin 24/);
  assert.doesNotMatch(msg, /Pas de donnée/);
  // Temoin : une serie vraiment vide garde son message.
  const vide = macro({ S_macroTab: 'rates', S_macroSub: 'policy', S_macroZone: 'CAD' });
  assert.match(vide.__el('macro-error').innerHTML, /Pas de donnée pour <strong>Taux directeur<\/strong>/);
});

test('macro (#42) : le PIB est libelle par trimestre (T1 2026), pas par mois', () => {
  const ctx = macro({ S_macroTab: 'gdp', S_macroSub: 'qoq', S_macroZone: 'USD' }); // 2025-12 : 0.5 ; 2026-03 : 2.0
  assert.deepEqual(axeX(), ['T4 2025', 'T1 2026']);
  assert.match(ctx.__el('macro-indic-latest').textContent, /: 2\.0 % \(T1 2026\)$/);
  const histo = ctx.__el('macro-table-wrap').innerHTML;
  assert.match(histo, /HISTORIQUE TRIMESTRIEL · États-Unis/);
  assert.match(histo, />T4 2025</);
  assert.doesNotMatch(histo, /MENSUEL|mars 26|déc\. 25/);
  assert.match(ctx.__el('macro-couverture').textContent, /de T4 2025 à T1 2026/);
  const eur = macro({ S_macroTab: 'gdp', S_macroSub: 'yoy', S_macroZone: 'EUR' }); // glissement annuel : trimestriel aussi
  assert.match(eur.__el('macro-indic-latest').textContent, /\(T4 2025\)$/);
  // Temoin : un onglet mensuel garde ses mois.
  const cpi = macro({ S_macroTab: 'inflation', S_macroSub: 'cpi', S_macroZone: 'USD' });
  assert.match(cpi.__el('macro-indic-latest').textContent, /\(avr\. 26\)$/);
  assert.match(cpi.__el('macro-table-wrap').innerHTML, /HISTORIQUE MENSUEL · États-Unis/);
});

const axeY = () => dernierGraphe().options.scales.y;
const bulleDuGraphe = (v, i = 0) => dernierGraphe().options.plugins.tooltip.callbacks.label({ parsed: { y: v }, dataset: dernierGraphe().data.datasets[i] });

test('macro (#44) : le solde commercial dit sa devise (Mds USD), valeur, info-bulle, historique et axe', () => {
  const ctx = macro({ S_macroTab: 'trade', S_macroSub: 'balance', S_macroZone: 'USD' });
  assert.match(ctx.__el('macro-indic-latest').textContent, /: -60\.3 Mds USD \(mars 26\)$/);
  assert.match(ctx.__el('macro-table-wrap').innerHTML, />-57\.8 Mds USD</);
  assert.equal(bulleDuGraphe(-60.3), 'USD · États-Unis : -60.3 Mds USD', 'info-bulle (zone portee par la serie)');
  assert.equal(axeY().ticks.callback(-60), '-60 Mds USD');
  assert.equal(axeY().title.display, false, 'une seule devise : pas d avertissement');
  // Deux devises superposees : l'axe et la description le disent.
  const cmp = macroAvec((D) => { D.EUR.trade.balance = [{ d: '2026-03', v: 12.5 }]; },
    { S_macroTab: 'trade', S_macroSub: 'balance', S_macroCompare: true, S_macroCompareZones: new Set(['USD', 'EUR']) });
  assert.equal(axeY().ticks.callback(-60), '-60 Mds');
  assert.equal(axeY().title.display, true);
  assert.match(axeY().title.text, /devise de chaque zone/);
  assert.equal(bulleDuGraphe(12.5, 1), 'EUR · Zone euro : +12.5 Mds EUR');
  assert.match(cmp.__el('macro-indic-desc').textContent, /ne se comparent pas/);
  // Temoin : un indicateur en % garde son unite.
  macro({ S_macroTab: 'inflation', S_macroSub: 'cpi', S_macroZone: 'USD' });
  assert.equal(axeY().ticks.callback(3.8), '3.8%');
  assert.equal(axeY().title.display, false);
});

// ─── Calendrier economique ───
function calendrier(etat = {}, maintenant = LUNDI_19_OCT) {
  const ctx = charger({ maintenant });
  injecter(ctx, etat);
  ctx.loadCalendar();
  return ctx;
}
const texte = (ctx, id) => ctx.__el(id).textContent;

// Lundi 12 octobre 2026, 10 h a Paris : semaine sans changement d'heure.
const LUNDI_12_OCT = new Date('2026-10-12T08:00:00Z');

test('calendrier (#34) : l aide ne pretend pas connaitre le fuseau du widget et suit le code choisi', () => {
  const ctx = calendrier({}, LUNDI_12_OCT);
  assert.equal(texte(ctx, 'cal-conv-statut'), 'fuseau du code 55 non vérifié');
  assert.equal(texte(ctx, 'cal-conv-ny'), '+6 h', 'temoin : ecart Paris - New York, semaine du 12/10');
  assert.equal(texte(ctx, 'cal-conv-lon'), '+1 h', 'ecart Paris - Londres');
  ctx.onCalTzChange('113'); // sans loadCalendar ni horloge : l'aide suit tout de suite
  assert.match(ctx.buildCalIframeSrc(), /timeZone=113/);
  assert.equal(texte(ctx, 'cal-conv-statut'), 'fuseau du code 113 non vérifié');
  // Plus aucun texte n'affirme le fuseau du widget.
  assert.doesNotMatch(sansCommentaires(SOURCE_APP), /heure par défaut Investing|c'est New York/);
  assert.doesNotMatch(SOURCE_HTML, /défaut Investing|Si iframe affiche/);
});

test('calendrier (#34) : un ancien code enregistre reste visible dans le menu', () => {
  const ctx = calendrier({ S_calTz: '999' });
  const menu = ctx.__el('cal-tz-pick');
  assert.ok(menu.children.some((o) => o.value === '999' && o.textContent === '999'), 'le code demande au widget est dans le menu');
  assert.equal(menu.value, '999');
  assert.equal(texte(ctx, 'cal-conv-statut'), 'fuseau du code 999 non vérifié');
});

test('calendrier (#35) : l ecart est celui des jours affiches (changements d heure du 25/10 et du 01/11)', () => {
  const ctx = calendrier(); // « Cette semaine » : 19/10 -> 25/10
  assert.equal(texte(ctx, 'cal-conv-ny'), "+6 h jusqu'au 24/10, puis +5 h");
  assert.equal(texte(ctx, 'cal-conv-lon'), '+1 h', 'Londres et Paris changent d heure le meme jour');
  ctx.choisirPeriodeCal('nextWeek'); // sans horloge : l'aide suit la periode tout de suite
  assert.match(ctx.buildCalIframeSrc(), /dateFrom=2026-10-26&dateTo=2026-11-01/);
  assert.equal(texte(ctx, 'cal-conv-ny'), "+5 h jusqu'au 31/10, puis +6 h");
  ctx.choisirPeriodeCal('today');
  assert.equal(texte(ctx, 'cal-conv-ny'), '+6 h');
  // Temoin : une semaine sans changement d'heure garde un ecart unique.
  const calme = calendrier({}, LUNDI_12_OCT);
  assert.equal(texte(calme, 'cal-conv-ny'), '+6 h');
  assert.match(calme.buildCalIframeSrc(), /dateFrom=2026-10-12&dateTo=2026-10-18/);
});

const paysDemandes = (ctx, zone) => {
  injecter(ctx, { S_calZone: zone });
  return (/[?&]countries=([^&]*)/.exec(ctx.buildCalIframeSrc()) || [])[1].split(',').filter(Boolean);
};

test('calendrier (#37) : le filtre EUR ne reprend aucun code que l app range sous une autre devise', () => {
  const ctx = calendrier();
  const codes = horsContexte(lire(ctx, 'CAL_ZONES').map((z) => z.code));
  const eur = paysDemandes(ctx, 'EUR');
  assert.ok(eur.includes('72'), 'temoin : la liste EUR est bien demandee');
  const unPays = codes.filter((c) => paysDemandes(ctx, c).length === 1); // USD, GBP, JPY…
  assert.ok(unPays.length >= 7, 'temoin : les zones a un seul pays sont lues');
  for (const zone of unPays) {
    const [c] = paysDemandes(ctx, zone);
    assert.ok(!eur.includes(c), 'EUR demande ' + c + ', code de la zone ' + zone);
  }
});

test('calendrier (#37) : la zone EUR dit que sa liste de pays n est pas verifiee', () => {
  const ctx = calendrier();
  assert.equal(texte(ctx, 'cal-zone-note'), '', 'temoin : rien sur « All »');
  ctx.choisirZoneCal('EUR');
  assert.match(ctx.buildCalIframeSrc(), /countries=72,/);
  assert.equal(texte(ctx, 'cal-zone-note'),
    'EUR : 16 codes pays demandés à Investing.com — liste non vérifiée, elle peut inclure des pays hors zone euro.');
  ctx.choisirZoneCal('USD');
  assert.equal(texte(ctx, 'cal-zone-note'), '');
});

test('calendrier (#38) : chaque bouton de zone demande un filtre distinct (plus de XAU identique a « All »)', () => {
  const ctx = calendrier();
  const zones = horsContexte(lire(ctx, 'CAL_ZONES').map((z) => z.code));
  assert.equal(ctx.__el('cal-zone-btns').children.length, zones.length, 'temoin : un bouton par zone');
  const urls = zones.map((z) => { injecter(ctx, { S_calZone: z }); return ctx.buildCalIframeSrc(); });
  assert.equal(new Set(urls).size, zones.length, 'deux boutons ne demandent jamais le meme calendrier');
  const sansPays = zones.filter((z) => paysDemandes(ctx, z).length === 0);
  assert.deepEqual(sansPays, ['ALL'], 'seul « All » demande tous les pays');
});

// Le fuseau du processus change le temps d'un test (Node relit TZ), puis revient a Paris.
function sousFuseau(tz, f) {
  process.env.TZ = tz;
  try { return f(); } finally { process.env.TZ = 'Europe/Paris'; }
}

test('calendrier (#45) : horloge et ecarts gardent les demi-heures (Inde, Terre-Neuve)', () => {
  sousFuseau('Asia/Kolkata', () => {
    const ctx = calendrier();
    assert.match(texte(ctx, 'cal-mytz'), /^GMT\+5:30 · /);
    assert.equal(texte(ctx, 'cal-conv-ny'), '+9 h 30');
    assert.equal(texte(ctx, 'cal-conv-lon'), "+4 h 30 jusqu'au 24/10, puis +5 h 30");
  });
  sousFuseau('America/St_Johns', () => {
    const ctx = calendrier();
    assert.match(texte(ctx, 'cal-mytz'), /^GMT-2:30 · St_Johns$/);
    assert.equal(texte(ctx, 'cal-conv-ny'), '+1 h 30');
    assert.equal(texte(ctx, 'cal-conv-lon'), "-3 h 30 jusqu'au 24/10, puis -2 h 30");
  });
  // Temoin : a Paris, heures pleines, sans minutes.
  const paris = calendrier({}, LUNDI_12_OCT);
  assert.match(texte(paris, 'cal-mytz'), /^GMT\+2 · Paris$/);
  assert.equal(texte(paris, 'cal-conv-lon'), '+1 h');
});

test('calendrier (#46) : le filtre d importance, fixe, est dit a l ecran', () => {
  const ctx = calendrier();
  const imp = (/[?&]importance=([^&]*)/.exec(ctx.buildCalIframeSrc()) || [])[1];
  assert.equal(imp, '2,3', 'temoin : le filtre est bien demande au widget');
  const etoiles = imp.split(',').map((n) => '★'.repeat(+n)).join(' et ');
  assert.equal(texte(ctx, 'cal-importance'), 'Importance demandée : ' + etoiles + ' (pas les annonces ★)');
});
