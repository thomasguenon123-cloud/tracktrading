'use strict';
// FND-04 : bibliotheques hebergees, versions exactes, empreintes SRI.
// Refuse toute version flottante et verifie empreintes.json <-> fichiers <->
// references. v=5 : une bibliotheque est referencee soit par index.html
// (<script src integrity>), soit par app.js (BIBLIOS : chargement a la demande).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RACINE, SOURCE_HTML, SOURCE_APP, sansCommentaires } = require('./charger-app.js');

function sri(fichier) {
  const buf = fs.readFileSync(path.join(RACINE, fichier));
  return 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
}

const BALISES_HTML = [...SOURCE_HTML.matchAll(/<script\b[^>]*\ssrc="([^"]+)"[^>]*>/g)].map((m) => ({ src: m[1], balise: m[0] }));
const BIBLIOS_APP = [...sansCommentaires(SOURCE_APP).matchAll(/src:'([^']+)',integrity:'([^']*)'/g)].map((m) => ({ src: m[1], integrity: m[2] }));

// Toutes les references a une bibliotheque hebergee, avec leur empreinte.
function references() {
  const refs = BALISES_HTML.filter((b) => b.src.startsWith('vendor/')).map((b) => ({
    ou: 'index.html', src: b.src, integrity: (/\sintegrity="([^"]*)"/.exec(b.balise) || [])[1] || '',
  }));
  return refs.concat(BIBLIOS_APP.map((b) => ({ ou: 'app.js', ...b })));
}

test('aucun <script src> vers un CDN', () => {
  assert.ok(BALISES_HTML.length >= 2, 'temoin positif : des scripts sont charges');
  const cdn = BALISES_HTML.map((b) => b.src).filter((s) => /^https?:\/\//i.test(s));
  assert.deepEqual(cdn, [], 'tout script doit etre heberge (vendor/ ou local)');
  const cdnApp = BIBLIOS_APP.map((b) => b.src).filter((s) => /^https?:\/\//i.test(s));
  assert.deepEqual(cdnApp, [], 'app.js ne charge rien depuis un CDN');
});

test('chaque bibliotheque vendor/ porte une empreinte integrity (index.html ET app.js)', () => {
  const refs = references();
  assert.ok(refs.some((r) => r.ou === 'index.html') && refs.some((r) => r.ou === 'app.js'), 'temoin positif : des deux cotes');
  for (const r of refs) assert.match(r.integrity, /^sha384-[A-Za-z0-9+/=]{64}$/, `integrity manquant (${r.ou}) : ${r.src}`);
});

test('empreintes.json concorde avec les fichiers ET avec chaque reference', () => {
  const emp = JSON.parse(fs.readFileSync(path.join(RACINE, 'vendor/empreintes.json'), 'utf8'));
  const fichiers = Object.keys(emp).filter((k) => !k.startsWith('_'));
  assert.ok(fichiers.length >= 2, 'temoin positif : des empreintes sont declarees');
  const refs = references();
  for (const f of fichiers) {
    assert.equal(emp[f], sri(f), 'empreinte obsolete pour ' + f + ' (recalculer apres toute mise a jour)');
    const r = refs.filter((x) => x.src === f);
    assert.ok(r.length >= 1, 'bibliotheque declaree mais jamais referencee : ' + f);
    for (const x of r) assert.equal(x.integrity, emp[f], `${x.ou} reference ${f} avec une autre empreinte`);
  }
  for (const r of refs) assert.ok(fichiers.includes(r.src), `${r.ou} reference un fichier vendor non declare : ${r.src}`);
});

test('aucune version flottante de bibliotheque (ni @N nu, ni chemin sans version)', () => {
  const refs = references();
  assert.ok(refs.length >= 2, 'temoin positif');
  for (const r of refs) assert.match(r.src, /\d+\.\d+\.\d+/, 'le chemin vendor doit porter une version exacte : ' + r.src);
});

// v=5 (UX-13/14) : l'ecran de connexion n'attend ni Chart.js ni une police externe.
test('index.html ne charge ni Chart.js ni feuille de style / police externe', () => {
  assert.ok(!BALISES_HTML.some((b) => /chart/i.test(b.src)), 'Chart.js se charge a la demande (app.js)');
  const liens = [...SOURCE_HTML.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(liens.some((l) => /href="styles\.css(\?v=\d+)?"/.test(l)), 'temoin positif : styles.css est lie');
  const externes = liens.filter((l) => /href="https?:\/\//i.test(l));
  assert.deepEqual(externes, [], 'aucune ressource externe bloquante');
});

// v=5 : scripts en defer, dans l'ordre (supabase-js AVANT app.js). Un seul des
// deux en defer = app.js s'execute avant supabase-js → « supabase is not defined ».
test('scripts en defer et dans l ordre : supabase-js puis app.js', () => {
  const externes = BALISES_HTML.map((b) => b);
  const iSb = externes.findIndex((b) => /supabase/.test(b.src));
  const iApp = externes.findIndex((b) => /^app\.js(\?|$)/.test(b.src));
  assert.ok(iSb >= 0 && iApp >= 0, 'temoin positif : les deux scripts existent');
  assert.ok(iSb < iApp, 'supabase-js doit preceder app.js');
  for (const b of [externes[iSb], externes[iApp]]) assert.match(b.balise, /\sdefer[\s>]/, 'defer manquant : ' + b.src);
});

// v=5 : index.html, app.js et styles.css vont ensemble (ecran d'attente, grille
// du tableau de bord, Chart.js a la demande). Sans ?v=N, un navigateur peut
// garder l'ancien app.js / styles.css en cache avec le nouvel index.html.
test('app.js et styles.css appeles avec ?v=N (pas d ancien fichier en cache)', () => {
  const app = BALISES_HTML.find((b) => /^app\.js(\?|$)/.test(b.src));
  const css = (/<link\b[^>]*href="(styles\.css[^"]*)"/.exec(SOURCE_HTML) || [])[1];
  assert.ok(app && css, 'temoin positif : les deux sont references');
  assert.match(app.src, /^app\.js\?v=\d+$/);
  assert.match(css, /^styles\.css\?v=\d+$/);
  assert.equal(app.src.split('=')[1], css.split('=')[1], 'meme numero de version pour les deux');
});
