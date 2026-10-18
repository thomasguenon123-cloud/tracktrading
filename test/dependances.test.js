'use strict';
// FND-04 : bibliotheques hebergees, versions exactes, empreintes SRI.
// Refuse toute version flottante et verifie empreintes.json <-> fichiers <-> index.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RACINE, SOURCE_HTML } = require('./charger-app.js');

function sri(fichier) {
  const buf = fs.readFileSync(path.join(RACINE, fichier));
  return 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
}

test('aucun <script src> vers un CDN', () => {
  const scripts = [...SOURCE_HTML.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 2, 'temoin positif : des scripts sont charges');
  const cdn = scripts.filter((s) => /^https?:\/\//i.test(s));
  assert.deepEqual(cdn, [], 'tout script doit etre heberge (vendor/ ou local)');
});

test('chaque script vendor/ porte une empreinte integrity', () => {
  const balises = [...SOURCE_HTML.matchAll(/<script\b[^>]*src="(vendor\/[^"]+)"[^>]*>/g)].map((m) => m[0]);
  assert.ok(balises.length >= 2, 'temoin positif');
  for (const b of balises) assert.match(b, /integrity="sha384-[A-Za-z0-9+/=]+"/, 'integrity manquant : ' + b);
});

test('empreintes.json concorde avec les fichiers ET avec index.html', () => {
  const emp = JSON.parse(fs.readFileSync(path.join(RACINE, 'vendor/empreintes.json'), 'utf8'));
  const fichiers = Object.keys(emp).filter((k) => !k.startsWith('_'));
  assert.ok(fichiers.length >= 2, 'temoin positif : des empreintes sont declarees');
  for (const f of fichiers) {
    assert.equal(emp[f], sri(f), 'empreinte obsolete pour ' + f + ' (recalculer apres toute mise a jour)');
    assert.ok(SOURCE_HTML.includes(emp[f]), 'index.html ne reference pas l empreinte de ' + f);
  }
  // Chaque integrity d'index.html correspond a un fichier vendor present.
  const integ = [...SOURCE_HTML.matchAll(/integrity="(sha384-[^"]+)"/g)].map((m) => m[1]);
  for (const i of integ) assert.ok(Object.values(emp).includes(i), 'integrity sans fichier vendor : ' + i);
});

test('aucune version flottante de bibliotheque (ni @N nu, ni chemin sans version)', () => {
  const srcs = [...SOURCE_HTML.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  for (const s of srcs.filter((x) => x.startsWith('vendor/'))) {
    assert.match(s, /\d+\.\d+\.\d+/, 'le chemin vendor doit porter une version exacte : ' + s);
  }
});
