'use strict';
// v=5 — Mobile (UX-01/02/10). Ces gardes vérifient les PRÉCONDITIONS du rendu
// mobile dans index.html et styles.css (un style en ligne bat toute media query ;
// une règle supprimée ne se voit pas sur un poste de bureau). La preuve du rendu
// reste le banc : `npm run banc` (débordement 390/820 px = 0, sinon échec) et
// `npm run mesures` (cibles tactiles, captures).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RACINE, SOURCE_HTML } = require('./charger-app.js');

const CSS = fs.readFileSync(path.join(RACINE, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Contenu des blocs @media dont la condition contient `condition` (espaces ignorés).
function blocsMedia(condition) {
  const voulu = condition.replace(/\s+/g, '');
  const out = [];
  const re = /@media\s*([^{]+)\{/g;
  let m;
  while ((m = re.exec(CSS))) {
    let prof = 1; let i = re.lastIndex;
    while (i < CSS.length && prof) { if (CSS[i] === '{') prof++; else if (CSS[i] === '}') prof--; i++; }
    if (m[1].replace(/\s+/g, '').includes(voulu)) out.push(CSS.slice(re.lastIndex, i - 1));
  }
  return out.join('\n');
}
// Règles d'un bloc : [{ selecteurs: [...], props: {prop: valeur} }]
function regles(bloc) {
  return [...bloc.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selecteurs: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    props: Object.fromEntries(m[2].split(';').map((d) => d.split(':')).filter((d) => d.length >= 2)
      .map(([k, ...v]) => [k.trim(), v.join(':').trim()])),
  }));
}
// Valeur de `prop` pour un sélecteur exact dans un bloc (dernière règle gagnante).
function valeur(bloc, selecteur, prop) {
  let v;
  for (const r of regles(bloc)) if (r.selecteurs.includes(selecteur) && prop in r.props) v = r.props[prop];
  return v;
}
const balise = (id) => (new RegExp(`<[a-z]+\\b[^>]*\\sid="${id}"[^>]*>`).exec(SOURCE_HTML) || [])[0];

test('viewport mobile déclaré', () => {
  assert.match(SOURCE_HTML, /<meta name="viewport" content="width=device-width/);
});

test('grands blocs sans style en ligne (sinon les media queries ne peuvent rien)', () => {
  for (const id of ['dash-main', 'dash-top-row', 'cur-single-view', 'macro-content', 'cal-content']) {
    const b = balise(id);
    assert.ok(b, 'témoin : #' + id + ' existe');
    assert.doesNotMatch(b, /\sstyle="/, '#' + id + ' : mise en page à décrire dans styles.css');
  }
});

test('panneau de détail du trade : jamais plus large que l écran', () => {
  const b = balise('trade-journal-panel');
  assert.match(b, /width:500px/, 'témoin : largeur bureau');
  assert.match(b, /max-width:100%/);
});

test('en-tête étroit : logo et actions sur une ligne, onglets sur une 2e ligne qui défile', () => {
  const b = blocsMedia('(max-width:1000px)');
  assert.equal(valeur(b, '#hdr', 'flex-wrap'), 'wrap');
  assert.equal(valeur(b, '.hdr-left', 'display'), 'contents');
  assert.equal(valeur(b, '.nav', 'overflow-x'), 'auto');
  assert.equal(valeur(b, '.nav-tab', 'flex-shrink'), '0');
});

test('téléphone : tableau de bord empilé, séparateurs à la souris masqués', () => {
  const b = blocsMedia('(max-width:760px)');
  assert.equal(valeur(b, '#dash-main', 'display'), 'flex');
  assert.equal(valeur(b, '#dash-main', 'flex-direction'), 'column');
  assert.equal(valeur(b, '#dash-main', 'height'), 'auto');
  assert.equal(valeur(b, '.dash-splitter', 'display'), 'none');
  assert.equal(valeur(b, '.cur-single-card', 'flex-direction'), 'column', 'Rapports : notes puis captures');
});

test('tactile : cibles d au moins 40 px, pas de zoom automatique d iOS', () => {
  const b = blocsMedia('(pointer:coarse)');
  for (const sel of ['.btn', '.acc-tab', '.f-sel', '.hdr-btn', '.modal-tab']) {
    assert.ok(parseFloat(valeur(b, sel, 'min-height')) >= 40, sel + ' : min-height >= 40px');
  }
  assert.ok(parseFloat(valeur(b, 'select', 'font-size')) >= 16, 'champs >= 16px (iOS zoome en dessous)');
});

test('« Supprimer » une capture : visible sans survol (tactile)', () => {
  const b = blocsMedia('(hover:none)');
  assert.equal(valeur(b, '.cur-paste-zone-v2.has-img .cur-paste-rm', 'display'), 'block');
  // témoin : sur bureau, le bouton reste discret (au survol)
  assert.equal(valeur(CSS, '.cur-paste-zone-v2 .cur-paste-rm', 'display'), 'none');
});
