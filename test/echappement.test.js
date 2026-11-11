'use strict';
// FND-02 + FND-11 : echappement et nettoyage des notes riches.
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire } = require('./charger-app.js');

// Marqueur INERTE (aucun script). S'il devient une balise, le texte n'est pas neutralise.
const PIEGE = '"><tt-xss data-champ="x"></tt-xss>';

test('esc() echappe & < > " et \'', () => {
  const { esc } = charger();
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(esc('a"b'), 'a&quot;b');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});

test('escJs() rend un litteral JS sans guillemet ni apostrophe nus', () => {
  const { escJs } = charger();
  const out = escJs(`x'); alert(1); //`);
  assert.ok(!out.includes('"'), 'aucun guillemet double nu (casserait l attribut onclick="...")');
  assert.ok(!out.includes("'"), 'aucune apostrophe nue (casserait la chaine JS)');
  assert.ok(out.startsWith('&quot;') && out.endsWith('&quot;'), 'chaine JSON echappee en HTML');
  // temoin positif : le contenu reste present, juste neutralise
  assert.match(out, /alert\(1\)/);
});

test('safeUrl() n accepte que http/https', () => {
  const { safeUrl } = charger();
  assert.equal(safeUrl('https://exemple.fr/a'), 'https://exemple.fr/a');
  assert.equal(safeUrl('http://exemple.fr'), 'http://exemple.fr');
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('data:text/html,x'), '#');
  assert.equal(safeUrl(null), '#');
});

test('sanitizeNotesHtml : garde la mise en forme, retire le reste', () => {
  const { sanitizeNotesHtml } = charger();
  assert.equal(sanitizeNotesHtml('<b>gras</b>'), '<b>gras</b>');
  assert.match(sanitizeNotesHtml('<span style="color:#00d68f">v</span>'), /<span style="color: ?#00d68f">v<\/span>/);
  const danger = sanitizeNotesHtml(PIEGE + '<script>alert(1)</script><img src=x onerror=alert(1)>');
  assert.ok(!danger.includes('<tt-xss'), 'balise inconnue retiree');
  assert.ok(!/<script|<img|onerror/i.test(danger), 'script / img / onerror retires');
  // une couleur hors liste blanche est retiree
  assert.ok(!sanitizeNotesHtml('<span style="color:#123456">x</span>').includes('#123456'));
});

test('journal : la note d analyse riche est nettoyee (pas de balise injectee)', () => {
  const ctx = charger();
  lire(ctx, 'S').filtered = [{
    id: 't1', status: 'closed', direction: 'LONG', instrument: 'EURUSD', trade_date: '2026-07-02',
    created_at: '2026-07-02T08:00:00Z', actual_rr: 1, pnl_amount: 10,
    analysis_notes: '<b>ok</b>' + PIEGE, users: null,
  }];
  ctx.renderJournal();
  const html = ctx.__el('j-list').innerHTML;
  assert.match(html, /<b>ok<\/b>/, 'temoin positif : la mise en forme est conservee');
  assert.ok(!html.includes('<tt-xss'), 'aucune balise injectee');
});

test('panneau detail : la note d analyse riche est nettoyee', async () => {
  const ctx = charger();
  const t = {
    id: '11111111-1111-4111-8111-111111111111', status: 'closed', direction: 'LONG',
    instrument: 'EURUSD', trade_date: '2026-07-02', created_at: '2026-07-02T08:00:00Z',
    actual_rr: 1, pnl_amount: 10, analysis_notes: '<i>contexte</i>' + PIEGE,
  };
  lire(ctx, 'S').trades = [t];
  await ctx.showTradeDetailById(t.id);
  const html = ctx.__el('tjp-content').innerHTML;
  assert.match(html, /<i>contexte<\/i>/, 'temoin positif : mise en forme conservee');
  assert.ok(!html.includes('<tt-xss'), 'aucune balise injectee');
});

// v=6 (FND-02 complété) : une balise interdite IMBRIQUÉE dans une balise retirée (a,
// span sans couleur, table…) doit être retirée aussi. Marqueur inerte, aucun script.
test('sanitizeNotesHtml : balise interdite imbriquée dans une balise retirée, retirée aussi', () => {
  const { sanitizeNotesHtml } = charger();
  for (const h of ['<a href="#"><tt-xss>x</tt-xss></a>', '<span><tt-xss>x</tt-xss></span>',
    '<b><span><tt-xss>y</tt-xss></span></b>', '<h2><tt-xss>w</tt-xss></h2>', '<div><a><tt-xss>v</tt-xss></a></div>']) {
    const out = sanitizeNotesHtml(h);
    assert.doesNotMatch(out, /tt-xss/i, h + ' → ' + out);
  }
  // témoin positif : texte et mise en forme autorisée survivent au déballage
  assert.equal(sanitizeNotesHtml('<a><b>ok</b></a>'), '<b>ok</b>');
  assert.equal(sanitizeNotesHtml('<span><i>it</i></span>'), '<i>it</i>');
});

// v=6 (revue) : la couleur d'un trader (public.users.color, modifiable par son
// propriétaire) et celle d'un pair en présence (envoyée par son navigateur) sont des
// champs libres rendus dans un attribut style : seule une couleur hexadécimale passe.
test('couleur du trader (journal) et du pair (présence) : seule une couleur hexadécimale est rendue', () => {
  const PIEGE = 'red"><tt-xss data-champ="couleur"></tt-xss><span style="x';
  const ctx = charger();
  const trade = (color) => ({ id: 't1', status: 'closed', direction: 'LONG', instrument: 'EURUSD', trade_date: '2026-10-20',
    created_at: '2026-10-20T08:00:00Z', actual_rr: 1, users: { name: 'Trader Fictif', color } });
  for (const p of [PIEGE, '#fff' + PIEGE]) { // le 2e commence par une vraie couleur
    const piege = ctx.tradeHTML(trade(p));
    assert.match(piege, /Trader Fictif/, 'témoin : le badge du trader est rendu');
    assert.ok(!piege.includes('<tt-xss'), 'aucune balise injectée (journal) : ' + p);
  }
  assert.match(ctx.tradeHTML(trade('#4da6ff')), /color:#4da6ff/, 'témoin : une vraie couleur est gardée');
  // Présence (Rapports) : la couleur vient du message de présence d'un autre navigateur
  lire(ctx, `_peers['c1']={user:'Trader Fictif',color:${JSON.stringify(PIEGE)},currency:S_curCode,lastSeen:Date.now()}`);
  lire(ctx, `_peers['c2']={user:'Autre Fictif',color:'#f0c040',currency:S_curCode,lastSeen:Date.now()}`);
  ctx.refreshPeersBadge();
  const pres = ctx.__el('presence-text').innerHTML;
  assert.match(pres, /Trader Fictif/, 'témoin : la présence est rendue');
  assert.match(pres, /background:#f0c040/, 'témoin : une vraie couleur est gardée');
  assert.ok(!pres.includes('<tt-xss'), 'aucune balise injectée (présence)');
});
