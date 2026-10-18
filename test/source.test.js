'use strict';
// Gardes qui lisent le source (commentaires masques au prealable).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, SOURCE_APP, SOURCE_HTML, IDS_HTML, RACINE, sansCommentaires } = require('./charger-app.js');

const CODE = sansCommentaires(SOURCE_APP);
const MOTS_JS = new Set(['if', 'event', 'this', 'document', 'window', 'return', 'typeof', 'function']);

// Identifiants appeles en tete d'expression dans les gestionnaires on*="..."
// d'index.html et des gabarits d'app.js (chaines retirees : 'var(--amber)').
function fonctionsAppelees(source) {
  const noms = new Set();
  for (const [, corps] of source.matchAll(/\son[a-z]+="([^"]*)"/g)) {
    const sansChaines = corps.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    for (const m of sansChaines.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!MOTS_JS.has(m[2])) noms.add(m[2]);
    }
  }
  return noms;
}

test('chaque gestionnaire en ligne appelle une fonction definie (pas de bouton mort)', () => {
  const ctx = charger();
  const noms = fonctionsAppelees(SOURCE_HTML + '\n' + CODE);
  assert.ok(noms.size >= 40, 'temoin positif : ' + noms.size + ' fonctions relevees');
  const manquantes = [...noms].filter((n) => typeof ctx[n] !== 'function');
  assert.deepEqual(manquantes, []);
});

// Ids attendus mais volontairement absents du DOM, avec leur raison.
const IDS_ABSENTS_ADMIS = {
  'm-tbody': 'tableau mensuel retire de la page ; renderMonthly() sort sans rien faire (FND-004)',
};

test('chaque getElementById litteral vise un id qui existe', () => {
  const idsGabarits = new Set([...SOURCE_APP.matchAll(/id="([^"$]+)"/g)].map((m) => m[1]));
  const lus = new Set([...CODE.matchAll(/getElementById\('([^'$]+)'\)/g)].map((m) => m[1]));
  assert.ok(lus.size > 100, 'temoin positif');
  const absents = [...lus].filter((id) => !IDS_HTML.has(id) && !idsGabarits.has(id) && !(id in IDS_ABSENTS_ADMIS));
  assert.deepEqual(absents, []);
});

test('aucune fenetre native confirm() / alert() / prompt()', () => {
  assert.deepEqual(CODE.match(/(^|[^\w.$])(confirm|alert|prompt)\s*\(/g) || [], []);
  assert.ok(/showConfirm\(/.test(CODE), 'temoin : la fenetre maison existe');
});

test('aucune date du jour lue en UTC ni de jours comptes en millisecondes', () => {
  assert.deepEqual(CODE.match(/toISOString\(\)\s*\.slice\(\s*0\s*,\s*(7|10)\s*\)/g) || [], []);
  assert.deepEqual(CODE.match(/86400000|1000\s*\*\s*60\s*\*\s*60\s*\*\s*24/g) || [], []);
  assert.ok(/function fmtYMD\(/.test(CODE), 'temoin : la fonction de date locale existe');
});

// Brief 6.2 : un "*/" qui n'a pas de "/*" ouvert colle la suite a la regle
// suivante ; un bloc sans selecteur traine.
function verifierCss(css) {
  const erreurs = [];
  let i = 0;
  let dansCommentaire = false;
  let ligne = 1;
  while (i < css.length) {
    if (css[i] === '\n') ligne++;
    if (!dansCommentaire && css.startsWith('/*', i)) { dansCommentaire = true; i += 2; continue; }
    if (dansCommentaire && css.startsWith('*/', i)) { dansCommentaire = false; i += 2; continue; }
    if (!dansCommentaire && css.startsWith('*/', i)) erreurs.push('fin de commentaire orpheline ligne ' + ligne);
    i++;
  }
  if (dansCommentaire) erreurs.push('commentaire jamais ferme');
  const sansComm = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of sansComm.matchAll(/(^|[{};])\s*\{/g)) erreurs.push('bloc sans selecteur a la position ' + m.index);
  return erreurs;
}

test('styles.css : commentaires bien fermes, aucun bloc sans selecteur', () => {
  const css = fs.readFileSync(path.join(RACINE, 'styles.css'), 'utf8');
  assert.ok(css.length > 10000, 'temoin positif');
  assert.deepEqual(verifierCss(css), []);
  // la garde elle-meme : un commentaire mal ferme doit etre vu
  assert.equal(verifierCss('.a{color:red}/* .b*/.c */ .d{x:1}').length, 1);
  assert.equal(verifierCss('.a{color:red} {display:flex}').length, 1);
});
