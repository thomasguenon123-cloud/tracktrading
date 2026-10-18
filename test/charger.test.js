'use strict';
// Canaris du banc de test : app.js se charge dans le contexte vm, et le
// masquage des commentaires (utilise par les gardes qui lisent le source)
// n'efface aucun code.
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, SOURCE_APP, sansCommentaires } = require('./charger-app.js');

function fonctionsGlobales(ctx) {
  return Object.keys(ctx).filter((k) => typeof ctx[k] === 'function').sort();
}

test('app.js se charge sans erreur et expose ses fonctions', () => {
  const ctx = charger();
  for (const nom of ['postLogin', 'initApp', 'calcStats', 'renderJournal', 'saveTrade', 'renderCurrencyView', 'loadMacro', 'esc']) {
    assert.equal(typeof ctx[nom], 'function', nom + ' doit etre une fonction globale');
  }
});

test('canari : le source sans commentaires definit exactement les memes fonctions', () => {
  const masque = sansCommentaires(SOURCE_APP);
  assert.ok(masque.length < SOURCE_APP.length, 'le masquage doit retirer quelque chose');
  assert.ok(!masque.includes('V9.2 FIX FUSEAU'), 'un commentaire connu doit avoir disparu');
  // une chaine ou un gabarit qui contient // doit survivre au masquage
  assert.ok(masque.includes('https://flagcdn.com/'), 'une URL dans un gabarit doit rester intacte');
  const original = fonctionsGlobales(charger());
  const rejoue = fonctionsGlobales(charger({ source: masque }));
  assert.ok(original.length > 150, 'temoin positif : app.js definit ses fonctions');
  assert.deepEqual(rejoue, original);
});
