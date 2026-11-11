'use strict';
// v=6 « données honnêtes » : journal et panneau de détail d'un trade.
// Chaque garde APPELLE le rendu (showTradeDetailById, renderJournal,
// loadImagesInView, renderExistingImgs) et porte un témoin positif : un rendu
// vide ne doit pas passer. Aucun script : marqueur inerte <tt-xss>.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, lire, faireDb } = require('./charger-app.js');

const PIEGE = '"><tt-xss data-champ="detail"></tt-xss>';
const ID = '11111111-1111-4111-8111-111111111111';

function tradeFictif(extra = {}) {
  return {
    id: ID, status: 'closed', direction: 'LONG', instrument: 'EURUSD', strategy: 'Order Block',
    trade_date: '2026-07-02', created_at: '2026-07-02T08:00:00Z',
    actual_rr: 1.5, pnl_amount: 150, entry_price: 1.0842, sl_price: 1.0798, tp_price: 1.093, risk_rr: 2,
    exit_price: 1.0908, lot_size: 0.5, session: 'London', timeframe: 'H4', setup_type: 'OB',
    execution_quality: 8, plan_respected: 'respected', entry_notes: 'Entree propre\nsur repli',
    management_notes: 'BE apres +1R', lessons: 'Patience payante', analysis_notes: 'Confluence H4',
    users: { name: 'Trader Fictif', color: '#4da6ff' }, is_test: false,
    ...extra,
  };
}

async function panneau(t, opts = {}) {
  const ctx = charger(opts);
  lire(ctx, 'S').trades = [t];
  if (opts.captures) ctx.__creer('tjp-imgs-single');
  await ctx.showTradeDetailById(t.id);
  return { ctx, html: ctx.__el('tjp-content').innerHTML, titre: ctx.__el('tjp-title').innerHTML };
}

// ─── Constat 30 : le panneau lit les vraies colonnes ───
test('panneau : SL, TP, R:R théo, leçons, notes d entrée, session, TF et setup sont affichés', async () => {
  const { html } = await panneau(tradeFictif());
  assert.match(html, /Entrée: <\/span>.*1\.0842/, 'témoin positif : le prix d entrée est rendu');
  assert.match(html, /SL: <\/span>.*1\.0798/, 'SL (sl_price)');
  assert.match(html, /TP: <\/span>.*1\.093/, 'TP (tp_price)');
  assert.match(html, /R:R théo: <\/span>.*\+2\.00/, 'R:R théo (risk_rr)');
  assert.match(html, /Patience payante/, 'leçon (lessons)');
  assert.match(html, /Entree propre<br>sur repli/, 'notes d entrée, retours à la ligne gardés');
  assert.match(html, /Session: <\/span>.*London/);
  assert.match(html, /TF: <\/span>.*H4/);
  assert.match(html, /Setup: <\/span>.*OB/);
});

test('panneau : une leçon seule ouvre la section Gestion & clôture', async () => {
  const { html } = await panneau(tradeFictif({ execution_quality: null, plan_respected: null, management_notes: null, lessons: 'Attendre la cloture H4' }));
  assert.match(html, /GESTION &amp; CLÔTURE/);
  assert.match(html, /Attendre la cloture H4/);
});

test('panneau : les nouveaux champs libres sont échappés (XSS)', async () => {
  const { html } = await panneau(tradeFictif({
    lessons: PIEGE, entry_notes: PIEGE, session: PIEGE, timeframe: PIEGE, setup_type: PIEGE, management_notes: PIEGE,
    sl_price: PIEGE, instrument: 'EUR' + PIEGE,
  }));
  assert.match(html, /LEÇONS · <\/span>(&quot;|")&gt;&lt;tt-xss/, 'témoin positif : la leçon piégée est rendue, échappée');
  assert.ok(!html.includes('<tt-xss'), 'aucune balise injectée');
});

// ─── Constat 32 : sans date de trade, la date de saisie est dite comme telle ───
function journal(trades, opts = {}) {
  const ctx = charger(opts);
  lire(ctx, 'S').filtered = trades;
  ctx.renderJournal();
  return { ctx, html: ctx.__el('j-list').innerHTML };
}

test('journal et panneau : trade sans date → « date non saisie · saisi le … », jamais présentée comme date du trade', async () => {
  const sansDate = tradeFictif({ trade_date: null, created_at: '2026-10-05T08:00:00Z' });
  const j = journal([sansDate]).html;
  assert.match(j, /EURUSD/, 'témoin positif : le trade est rendu');
  assert.match(j, /date non saisie · saisi le 05\/10\/26/);
  const { titre } = await panneau(sansDate);
  assert.match(titre, /date non saisie · saisi le 05\/10\/26/);
});

test('journal et panneau : trade daté → sa date, sans mention « non saisie » (témoin)', async () => {
  const date = tradeFictif();
  const j = journal([date]).html;
  assert.match(j, /· 02\/07\/26</);
  assert.doesNotMatch(j, /non saisie ·|date non saisie/);
  const { titre } = await panneau(date);
  assert.match(titre, />02\/07\/26</);
  assert.doesNotMatch(titre, /date non saisie/);
});

// ─── Constat 27 : filtres du Journal (intégration v=6) ───
test('journal : un filtre qui masque tous les trades le dit, sans « + Nouveau Trade pour commencer »', () => {
  const ctx = charger();
  lire(ctx, 'S').trades = [tradeFictif({ status: 'closed' })];
  ctx.__el('f-stat').value = 'open';
  ctx.filterJournal();
  const html = ctx.__el('j-list').innerHTML;
  assert.match(html, /Aucun trade ne correspond aux filtres/);
  assert.match(html, /1 trade au journal/, 'le nombre de trades masqués est dit');
  assert.doesNotMatch(html, /pour commencer/);
  // Témoin : journal réellement vide → l invitation à créer un trade est vraie
  lire(ctx, 'S').trades = [];
  ctx.__el('f-stat').value = '';
  ctx.filterJournal();
  assert.match(ctx.__el('j-list').innerHTML, /<h3>Aucun trade<\/h3><p>\+ Nouveau Trade pour commencer/);
});

test('journal : après un rechargement (clôture, sauvegarde…), les filtres affichés restent appliqués', async () => {
  const trades = [tradeFictif({ id: 't-clos', status: 'closed' }), tradeFictif({ id: 't-ouvert', status: 'open', instrument: 'GBPUSD' })];
  const ctx = charger({ db: faireDb({ reponses: { trades: { data: trades, error: null } } }), muet: true });
  ctx.__el('f-stat').value = 'open';
  await ctx.rechargerTrades(false);
  const html = ctx.__el('j-list').innerHTML;
  assert.match(html, /GBPUSD/, 'témoin : le trade en cours est rendu');
  assert.doesNotMatch(html, /EURUSD/, 'le trade clos reste masqué par « En cours »');
});

// ─── Constat 0 (journal et panneau) : un R non saisi n'est pas un BE ───
function bandeau(html) {
  const m = /<!-- Bandeau résultat -->([\s\S]*?)<!-- ANALYSE -->/.exec(html);
  assert.ok(m, 'témoin : le bandeau de résultat existe');
  return m[1];
}

test('panneau : trade clos sans R saisi → « Résultat non saisi », bordure neutre, jamais « +0.00R » jaune', async () => {
  const b = bandeau((await panneau(tradeFictif({ actual_rr: null }))).html);
  assert.match(b, /Résultat non saisi/);
  assert.match(b, /Modifier ce trade/, 'invite à compléter');
  assert.doesNotMatch(b, /0\.00R/);
  assert.doesNotMatch(b, /var\(--yellow\)/, 'le jaune est réservé au BE saisi');
  assert.match(b, /border-left:3px solid var\(--border2\)/);
});

test('panneau : un vrai BE (0 saisi) reste « 0.00R » jaune, un gain « +1.50R » vert (témoins)', async () => {
  const be = bandeau((await panneau(tradeFictif({ actual_rr: 0 }))).html);
  assert.match(be, /color:var\(--yellow\)">0\.00R</);
  assert.doesNotMatch(be, /Résultat non saisi/);
  const gain = bandeau((await panneau(tradeFictif())).html);
  assert.match(gain, /color:var\(--green\)">\+1\.50R</);
});

test('panneau : trade en cours → aucun résultat chiffré', async () => {
  const b = bandeau((await panneau(tradeFictif({ status: 'open', actual_rr: null, pnl_amount: null }))).html);
  assert.match(b, /Trade en cours/, 'témoin positif : le bandeau dit l état');
  assert.doesNotMatch(b, /\d\.\d\dR/);
  assert.doesNotMatch(b, /Résultat non saisi/);
});

test('journal : clos sans R → « Résultat non saisi » (en-tête et corps) ; BE saisi affiché « 0.00R »', () => {
  const { html } = journal([
    tradeFictif({ id: 'sansR', actual_rr: null }),
    tradeFictif({ id: 'be', instrument: 'GBPJPY', actual_rr: 0 }),
    tradeFictif({ id: 'ouvert', instrument: 'XAUUSD', status: 'open', actual_rr: null }),
  ]);
  const [sansR, be, ouvert] = html.split('<div class="tj-item').slice(1);
  assert.match(sansR, /Résultat non saisi/);
  assert.match(sansR, /R:R réalisé: <\/span><span style="color:var\(--text3\);[^"]*">non saisi/);
  assert.doesNotMatch(sansR, /0\.00R/);
  assert.match(be, /color:var\(--yellow\)">0\.00R</, 'témoin : le BE saisi est montré (avant : masqué)');
  assert.match(be, /R:R réalisé: <\/span><span style="color:var\(--yellow\)[^"]*">0\.00</);
  assert.doesNotMatch(ouvert, /Résultat non saisi|\d\.\d\dR/, 'un trade en cours n a pas de résultat');
});

// ─── Constat 2 (journal et panneau) : P&L seulement s'il est saisi, dans la devise du compte ───
test('panneau : P&L non saisi → « P&L non saisi », jamais un montant à 0', async () => {
  const b = bandeau((await panneau(tradeFictif({ pnl_amount: null }))).html);
  assert.match(b, /\+1\.50R/, 'témoin positif : le R est rendu');
  assert.match(b, /P&amp;L non saisi/);
  assert.doesNotMatch(b, /\$|0,00|0\.00 ?\$/);
});

test('panneau : P&L saisi dans la devise du compte du trade ; un 0 saisi est montré', async () => {
  const eur = bandeau((await panneau(tradeFictif({ accounts: { currency: 'EUR' } }))).html);
  assert.match(eur, /color:var\(--green\)[^>]*>\+150,00\s€</);
  assert.doesNotMatch(eur, /\$|P&amp;L non saisi/);
  const zero = bandeau((await panneau(tradeFictif({ pnl_amount: 0, accounts: { currency: 'EUR' } }))).html);
  assert.match(zero, />0,00\s€</, 'un P&L saisi à 0 n est pas une absence');
  // devise lue sur le compte chargé quand la jointure manque
  const ctx = charger();
  const S = lire(ctx, 'S');
  S.accounts = [{ id: 'acc-chf', currency: 'CHF' }];
  S.trades = [tradeFictif({ account_id: 'acc-chf', pnl_amount: -80 })];
  await ctx.showTradeDetailById(ID);
  assert.match(bandeau(ctx.__el('tjp-content').innerHTML), /-80,00\sCHF/);
});

test('panneau : trade en cours avec des valeurs saisies → dites « saisies », pas comme un résultat', async () => {
  const b = bandeau((await panneau(tradeFictif({ status: 'open', actual_rr: 1.5, pnl_amount: 150, accounts: { currency: 'USD' } }))).html);
  assert.match(b, /Trade en cours/);
  assert.match(b, /Saisi : \+1\.50R · \+150,00\s\$US \(trade encore ouvert\)/);
  assert.doesNotMatch(b, /font-size:22px/, 'pas de grand résultat chiffré');
});

test('journal : P&L dans la devise du compte (en-tête et corps), « non saisi » dans le corps s il manque', () => {
  const { html } = journal([
    tradeFictif({ id: 'usd', pnl_amount: -80, actual_rr: -1, accounts: { currency: 'USD' } }),
    tradeFictif({ id: 'sansPnl', instrument: 'GBPJPY', pnl_amount: null }),
    tradeFictif({ id: 'zero', instrument: 'XAUUSD', pnl_amount: 0, accounts: { currency: 'EUR' } }),
  ]);
  const [usd, sansPnl, zero] = html.split('<div class="tj-item').slice(1).map((x) => x.split('class="tj-body"'));
  assert.equal(zero.length, 2, 'témoin : en-tête et corps séparés');
  assert.match(usd[0], /color:var\(--red\)">-80,00\s\$US<\/span>/, 'en-tête : montant dans la devise du compte');
  assert.match(usd[1], /P&amp;L: <\/span><span style="color:var\(--red\)[^"]*">-80,00\s\$US/, 'corps');
  assert.doesNotMatch(usd.join(''), /-\$80/, 'plus de « $ » écrit en dur');
  assert.match(sansPnl[1], /P&amp;L: <\/span><span style="color:var\(--text3\)[^"]*">non saisi/);
  assert.doesNotMatch(sansPnl.join(''), /\$/);
  assert.match(zero[0], /color:var\(--text2\)">0,00\s€<\/span>/, 'en-tête : un 0 saisi est montré (avant : masqué)');
  assert.match(zero[1], /P&amp;L: <\/span><span style="color:var\(--text2\)[^"]*">0,00\s€/, 'corps : idem');
});

test('journal et panneau : une devise de compte illisible est échappée (XSS)', async () => {
  const t = tradeFictif({ accounts: { currency: PIEGE } });
  const j = journal([t]).html;
  assert.match(j, /150,00 (&quot;|")&gt;&lt;tt-xss/, 'témoin positif : montant rendu avec le code tel quel, échappé');
  assert.ok(!j.includes('<tt-xss'));
  const { html } = await panneau(t);
  assert.match(html, /150,00 (&quot;|")&gt;&lt;tt-xss/);
  assert.ok(!html.includes('<tt-xss'));
});

// ─── Constat 31 : un fichier joint non image se montre par son nom, avec son lien ───
const PJ = [
  { storage_path: 'trades/t1/entry/capture.png', image_type: 'entry', mime_type: 'image/png', filename: 'capture.png' },
  { storage_path: 'trades/t1/file/releve.pdf', image_type: 'file', mime_type: 'application/pdf', filename: 'releve.pdf' },
  { storage_path: 'trades/t1/close/bilan.pdf', image_type: 'close', mime_type: 'application/pdf', filename: 'bilan.pdf' },
  { storage_path: 'trades/t1/close/ancien.png', image_type: 'close', filename: 'ancien.png' }, // ligne ancienne sans mime_type
  { storage_path: 'trades/t1/file/scan.pdf', image_type: 'file', filename: 'scan.pdf' }, // idem, non image
];
const lien = (nom) => new RegExp(`📄 <a href="https://exemple\\.invalid/signe/trades/t1/\\w+/${nom.replace('.', '\\.')}"[^>]*>${nom.replace('.', '\\.')}</a>`);
const balisesImg = (html) => (html.match(/<img /g) || []).length;

test('panneau : images en grand, PDF par leur nom avec leur lien, groupes Entrée / Clôture / Analyse et fichiers', async () => {
  const db = faireDb({ reponses: { trade_images: { data: PJ, error: null } } });
  const { ctx } = await panneau(tradeFictif({ id: 't1' }), { db, captures: true });
  const html = ctx.__el('tjp-imgs-single').innerHTML;
  assert.equal(balisesImg(html), 2, 'témoin positif : capture.png et ancien.png en <img>, aucun PDF');
  assert.match(html, /<img src="https:\/\/exemple\.invalid\/signe\/trades\/t1\/entry\/capture\.png"/);
  assert.doesNotMatch(html, /<img [^>]*\.pdf/, 'aucun PDF dans une balise <img>');
  for (const nom of ['releve.pdf', 'bilan.pdf', 'scan.pdf']) assert.match(html, lien(nom), nom + ' : nom + lien');
  assert.match(html, />Entrée</); assert.match(html, />Clôture</); assert.match(html, />Analyse et fichiers</);
  assert.doesNotMatch(html, />(entry|close|file)</, 'plus de libellés techniques');
  assert.equal(db.signatures.length, 1, 'toujours une seule requête de signature');
});

test('journal : un PDF d Entrée ou de Clôture n est plus une vignette, il est listé avec son lien', async () => {
  const db = faireDb({ reponses: { trade_images: { data: PJ, error: null } } });
  const ctx = charger({ db });
  ['ig-entry-t1', 'ig-close-t1', 'ig-file-t1', 'fl-t1'].forEach((id) => ctx.__creer(id));
  await ctx.loadImagesInView('t1');
  assert.match(ctx.__el('ig-entry-t1').innerHTML, /<img src="[^"]*capture\.png"/, 'témoin positif : vignette rendue');
  assert.match(ctx.__el('ig-close-t1').innerHTML, /<img src="[^"]*ancien\.png"/, 'ligne ancienne sans type, extension d image');
  assert.doesNotMatch(ctx.__el('ig-close-t1').innerHTML, /bilan/, 'le PDF de Clôture n est pas une vignette');
  const fl = ctx.__el('fl-t1').innerHTML;
  for (const nom of ['releve.pdf', 'bilan.pdf', 'scan.pdf']) assert.match(fl, lien(nom), nom);
  assert.equal(db.signatures.length, 1);
});

test('fiche : un PDF déjà joint est montré par son nom (avant : invisible)', async () => {
  const db = faireDb();
  const ctx = charger({ db });
  lire(ctx, 'S').existingImgs = PJ;
  await ctx.renderExistingImgs();
  assert.match(ctx.__el('prev-entry').innerHTML, /<img src="[^"]*capture\.png"/, 'témoin positif');
  const cloture = ctx.__el('prev-close').innerHTML;
  assert.match(cloture, lien('bilan.pdf'));
  assert.match(cloture, /<img src="[^"]*ancien\.png"/);
  assert.doesNotMatch(cloture, /<img [^>]*\.pdf/);
  assert.match(ctx.__el('prev-file').innerHTML, lien('releve.pdf'));
  assert.equal(db.signatures.length, 1);
});

test('pièces jointes : nom de fichier piégé échappé, lien signé seulement en http(s) (XSS)', async () => {
  const db = faireDb({ reponses: { trade_images: { data: [
    { storage_path: 'trades/t1/file/x.pdf', image_type: 'file', mime_type: 'application/pdf', filename: 'releve' + PIEGE + '.pdf' },
  ], error: null } } });
  const ctx = charger({ db });
  ctx.__creer('fl-t1');
  await ctx.loadImagesInView('t1');
  const fl = ctx.__el('fl-t1').innerHTML;
  assert.match(fl, /releve(&quot;|")&gt;&lt;tt-xss/, 'témoin positif : nom rendu, échappé');
  assert.ok(!fl.includes('<tt-xss'));
  assert.equal(ctx.fichierHTML({ filename: 'a.pdf' }, 'javascript:alert(1)').includes('javascript:'), false, 'lien non http(s) neutralisé');
});

// ─── Constat 29 : un échec de lecture ou de signature des captures est dit ───
const DEUX = [
  { storage_path: 'trades/t1/entry/a.png', image_type: 'entry', mime_type: 'image/png', filename: 'a.png' },
  { storage_path: 'trades/t1/close/b.png', image_type: 'close', mime_type: 'image/png', filename: 'b.png' },
];
const LECTURE_KO = { data: null, error: { message: 'refus' } };
// Signature groupée en panne (Storage injoignable) : le faux client rend une erreur ou lève.
function signatureEnPanne(db, { leve = false } = {}) {
  db.storage.from = () => ({
    createSignedUrls: async (chemins) => {
      db.signatures.push([...chemins]);
      if (leve) throw new Error('réseau');
      return { data: null, error: { message: 'refus' } };
    },
  });
  return db;
}
const INDISPO = /Captures indisponibles \(réseau \?\)/;

test('panneau : lecture des captures en échec → « Captures indisponibles », pas « Aucune capture » ; Réessayer relit', async () => {
  const reponses = { trade_images: LECTURE_KO };
  const { ctx } = await panneau(tradeFictif({ id: 't1' }), { db: faireDb({ reponses }), captures: true });
  const html = ctx.__el('tjp-imgs-single').innerHTML;
  assert.match(html, /▪ CAPTURES/, 'témoin : la section reste là');
  assert.match(html, INDISPO);
  assert.doesNotMatch(html, /Aucune capture/);
  const m = /onclick="(showTradeDetailById\([^"]*\))">Réessayer</.exec(html);
  assert.ok(m, 'un bouton Réessayer relance le panneau de CE trade');
  reponses.trade_images = { data: DEUX, error: null }; // le réseau revient
  await lire(ctx, m[1].replace(/&quot;/g, '"'));
  assert.equal(balisesImg(ctx.__el('tjp-imgs-single').innerHTML), 2, 'après Réessayer : les captures sont là');
});

test('panneau : aucune capture → « Aucune capture » (témoin, pas de message d échec)', async () => {
  const { ctx } = await panneau(tradeFictif({ id: 't1' }), { db: faireDb({ reponses: { trade_images: { data: [], error: null } } }), captures: true });
  const html = ctx.__el('tjp-imgs-single').innerHTML;
  assert.match(html, /Aucune capture/);
  assert.doesNotMatch(html, /indisponible/);
});

test('panneau : signature des liens en échec → message, la section ne disparaît plus ; échec partiel compté', async () => {
  const db = signatureEnPanne(faireDb({ reponses: { trade_images: { data: DEUX, error: null } } }));
  const { ctx } = await panneau(tradeFictif({ id: 't1' }), { db, captures: true });
  const html = ctx.__el('tjp-imgs-single').innerHTML;
  assert.match(html, INDISPO);
  assert.match(html, /Réessayer/);
  const partiel = faireDb({ reponses: { trade_images: { data: [...DEUX, { storage_path: 'trades/t1/entry/refuse.png', image_type: 'entry', mime_type: 'image/png' }], error: null } } });
  const p = await panneau(tradeFictif({ id: 't1' }), { db: partiel, captures: true });
  const h = p.ctx.__el('tjp-imgs-single').innerHTML;
  assert.equal(balisesImg(h), 2, 'témoin : les captures signées sont montrées');
  assert.match(h, /1 capture indisponible \(réseau \?\)/);
});

test('journal : lecture ou signature en échec → « Captures indisponibles » avec Réessayer ; partiel compté', async () => {
  const grilles = (ctx) => ['ig-entry-t1', 'ig-close-t1', 'ig-file-t1', 'fl-t1'].forEach((id) => ctx.__creer(id));
  const lecture = charger({ db: faireDb({ reponses: { trade_images: LECTURE_KO } }) });
  grilles(lecture);
  await lecture.loadImagesInView('t1');
  assert.match(lecture.__el('ig-entry-t1').innerHTML, INDISPO);
  assert.match(lecture.__el('ig-entry-t1').innerHTML, /onclick="loadImagesInView\(&quot;t1&quot;\)">Réessayer/);
  const signature = charger({ db: signatureEnPanne(faireDb({ reponses: { trade_images: { data: DEUX, error: null } } }), { leve: true }) });
  grilles(signature);
  await signature.loadImagesInView('t1');
  assert.match(signature.__el('ig-entry-t1').innerHTML, INDISPO);
  assert.equal(signature.__el('ig-close-t1').innerHTML, '', 'un seul message, pas de sablier oublié');
  const partiel = charger({ db: faireDb({ reponses: { trade_images: { data: [...DEUX,
    { storage_path: 'trades/t1/close/refuse.png', image_type: 'close', mime_type: 'image/png' },
    { storage_path: 'trades/t1/file/refuse.pdf', image_type: 'file', mime_type: 'application/pdf', filename: 'refuse.pdf' },
  ], error: null } } }) });
  grilles(partiel);
  await partiel.loadImagesInView('t1');
  assert.match(partiel.__el('ig-entry-t1').innerHTML, /<img src="[^"]*a\.png"/, 'témoin positif : vignette rendue');
  assert.match(partiel.__el('ig-close-t1').innerHTML, /<img src="[^"]*b\.png"[\s\S]*1 capture indisponible \(réseau \?\)/);
  assert.doesNotMatch(partiel.__el('ig-entry-t1').innerHTML, /indisponible/);
  assert.match(partiel.__el('fl-t1').innerHTML, /📄 refuse\.pdf <span[^>]*>— lien indisponible \(réseau \?\)/, 'un fichier non signé garde son nom');
});

test('fiche : captures déjà enregistrées indisponibles → dit dans l onglet (inutile de les recoller)', async () => {
  const lecture = charger();
  lire(lecture, 'S').existingImgs = null; // lecture en échec
  await lecture.renderExistingImgs();
  assert.match(lecture.__el('prev-entry').innerHTML, /Captures déjà enregistrées indisponibles \(réseau \?\) : inutile de les recoller/);
  const db = signatureEnPanne(faireDb());
  const signature = charger({ db });
  lire(signature, 'S').existingImgs = DEUX;
  await signature.renderExistingImgs();
  assert.equal(db.signatures.length, 1);
  assert.match(signature.__el('prev-entry').innerHTML, /1 capture déjà enregistrée indisponible \(réseau \?\) : inutile de la recoller/);
  assert.match(signature.__el('prev-close').innerHTML, /1 capture déjà enregistrée indisponible/);
  const ok = charger();
  lire(ok, 'S').existingImgs = DEUX;
  await ok.renderExistingImgs();
  assert.match(ok.__el('prev-entry').innerHTML, /<img src="[^"]*a\.png"/, 'témoin positif');
  assert.doesNotMatch(ok.__el('prev-entry').innerHTML, /indisponible/);
});
