'use strict';
// Charge app.js (script de navigateur, sans modules) dans un contexte node:vm
// muni de doublures minimales : document inerte, client Supabase inerte,
// localStorage en memoire, Chart.js factice. Aucune dependance : node --test suffit.
//
// Pieges (voir CLAUDE.md) :
//  - figer le temps : charger({ maintenant: new Date('...') }) ;
//  - les let/const de haut niveau d'app.js ne sont PAS des proprietes du
//    contexte : les lire avec lire(ctx, 'S_rptMonth'), les ecrire avec injecter() ;
//  - un tableau venu du contexte echoue en deepStrictEqual (autre royaume) :
//    passer par horsContexte(x).

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const miniDom = require('./mini-dom.js');

const RACINE = path.join(__dirname, '..');
const SOURCE_APP = fs.readFileSync(path.join(RACINE, 'app.js'), 'utf8');
const SOURCE_HTML = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
// Les id presents dans index.html existent dans le faux document ; les autres
// (crees par des gabarits) rendent null, comme dans le navigateur avant rendu.
const IDS_HTML = new Set([...SOURCE_HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

function listeClasses() {
  const s = new Set();
  return {
    add: (...c) => c.forEach((x) => s.add(x)),
    remove: (...c) => c.forEach((x) => s.delete(x)),
    toggle: (c, force) => {
      const on = force === undefined ? !s.has(c) : !!force;
      if (on) s.add(c); else s.delete(c);
      return on;
    },
    contains: (c) => s.has(c),
    toString: () => [...s].join(' '),
  };
}

function contexte2d() {
  return new Proxy({}, {
    get: (_, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
  });
}

function elementInerte(id = '', tag = 'div') {
  const attributs = {};
  const el = {
    id, tagName: String(tag).toUpperCase(), nodeType: 1,
    style: { cssText: '', setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {}, classList: listeClasses(),
    children: [], childNodes: [], attributes: [],
    parentNode: { replaceChild() {}, insertBefore() {}, removeChild() {}, appendChild() {} },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, replaceChild() {}, insertBefore() {}, remove() {},
    setAttribute(k, v) { attributs[k] = String(v); },
    getAttribute(k) { return k in attributs ? attributs[k] : null; },
    removeAttribute(k) { delete attributs[k]; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, matches() { return false; }, contains() { return false; },
    focus() {}, blur() {}, click() {},
    getContext: contexte2d,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    innerHTML: '', outerHTML: '', textContent: '', value: '', checked: false, disabled: false,
    offsetWidth: 0, offsetHeight: 0, lastElementChild: null, firstChild: null,
  };
  return el;
}

// Client Supabase inerte : toute chaine d'appels rend { data, error } ;
// `reponses` permet de fixer la reponse d'une table ou d'une fonction rpc.
// Les ecritures sont enregistrees dans `appels` (table, operation, charge, filtres).
function faireDb({ reponses = {}, appels = [] } = {}) {
  function requete(nom, type) {
    const etat = { nom, type, op: 'select', charge: null, filtres: [] };
    const p = new Proxy(function () {}, {
      get(_, k) {
        if (k === 'then') {
          if (etat.op !== 'select') appels.push({ table: nom, op: etat.op, charge: etat.charge, filtres: etat.filtres });
          const r = reponses[nom];
          const rep = typeof r === 'function' ? r(etat) : (r || { data: [], error: null });
          return (ok, ko) => Promise.resolve(rep).then(ok, ko);
        }
        if (['insert', 'update', 'delete', 'upsert'].includes(k)) {
          return (charge) => { etat.op = k; etat.charge = charge; return p; };
        }
        if (['eq', 'neq', 'in', 'gt', 'lt', 'gte', 'lte', 'is'].includes(k)) {
          return (c, v) => { etat.filtres.push([k, c, v]); return p; };
        }
        return () => p;
      },
      apply() { return p; },
    });
    return p;
  }
  const canal = new Proxy({}, {
    get: (_, k) => (k === 'presenceState' ? () => ({}) : () => canal),
  });
  // Liens signes : chaque appel est note (signatures = lots groupes, unitaires =
  // un fichier). Un chemin contenant « refuse » echoue, comme un fichier sans droit.
  const signatures = [];
  const unitaires = [];
  return {
    appels, signatures, unitaires,
    from: (t) => requete(t, 'table'),
    rpc: (f) => requete(f, 'rpc'),
    channel: () => canal,
    removeChannel() {},
    storage: {
      from: () => ({
        upload: async () => ({ data: {}, error: null }),
        remove: async () => ({ data: [], error: null }),
        createSignedUrl: async (chemin) => {
          unitaires.push(chemin);
          return { data: { signedUrl: 'https://exemple.invalid/signe' }, error: null };
        },
        createSignedUrls: async (chemins) => {
          signatures.push([...chemins]);
          return {
            data: chemins.map((p) => (p.includes('refuse')
              ? { path: p, signedURL: null, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' }
              : { path: p, signedURL: '/s/' + p, signedUrl: 'https://exemple.invalid/signe/' + p, error: null })),
            error: null,
          };
        },
      }),
    },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signUp: async () => ({ data: {}, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
    },
  };
}

class ChartFactice {
  constructor(canvas, config) {
    this.canvas = canvas; this.config = config;
    this.data = config.data; this.options = config.options;
    ChartFactice.instances.push(this);
  }
  destroy() {} update() {} resize() {}
}
ChartFactice.instances = [];

// source : permet de charger une variante d'app.js (canari du masquage, mutations).
// sansChart : Chart.js absent au depart, comme dans le navigateur depuis la v=5
// (charge a la demande par chargerBiblio ; le test simule l'arrivee du fichier).
// muet : la console de l'app est capturee dans ctx.__console (un test qui passe
// n'affiche pas d'erreur attendue). minuteriesImmediates : setTimeout s'execute
// au tour suivant (sinon il ne s'execute jamais).
function charger({ maintenant, db, html = SOURCE_HTML, source = SOURCE_APP, sansChart = false, muet = false, minuteriesImmediates = false } = {}) {
  const D = Date;
  const DateFigee = maintenant
    ? new Proxy(D, {
      construct(c, a) { return a.length ? new c(...a) : new D(maintenant.getTime()); },
      apply() { return new D(maintenant.getTime()).toString(); },
      get(c, k) { return k === 'now' ? () => maintenant.getTime() : Reflect.get(c, k); },
    })
    : D;
  const ids = html === SOURCE_HTML ? IDS_HTML : new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const elements = new Map();
  const document = {
    body: elementInerte('body', 'body'), head: elementInerte('head', 'head'),
    documentElement: elementInerte('html', 'html'),
    fullscreenElement: null,
    // createElement rend un noeud reel (mini-DOM) : sanitizeNotesHtml en a besoin
    // (DOMParser + createElement('span')). getElementById reste inerte (ci-dessous)
    // pour que les gardes lisent l'innerHTML tel que le rendu l'ecrit.
    createElement: (tag) => miniDom.createElement(tag),
    getElementById(id) {
      if (!ids.has(id) && !elements.has(id)) return null;
      if (!elements.has(id)) elements.set(id, elementInerte(id));
      return elements.get(id);
    },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    execCommand() { return true; }, queryCommandState() { return false; },
  };
  const memoire = new Map();
  const localStorage = {
    getItem: (k) => (memoire.has(k) ? memoire.get(k) : null),
    setItem: (k, v) => memoire.set(k, String(v)), removeItem: (k) => memoire.delete(k),
  };
  const client = db || faireDb();
  const journal = [];
  const consoleMuette = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map((n) => [n, (...a) => journal.push([n, ...a])]));
  const ctx = {
    console: muet ? consoleMuette : console, Date: DateFigee, Intl,
    setTimeout: minuteriesImmediates ? (f) => { setImmediate(f); return 1; } : () => 0,
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    queueMicrotask,
    document, localStorage,
    location: { href: 'https://exemple.invalid/tracktrading/', hash: '', search: '', origin: 'https://exemple.invalid', pathname: '/tracktrading/', reload() {} },
    navigator: { userAgent: 'test' },
    supabase: { createClient: () => client },
    ...(sansChart ? {} : { Chart: ChartFactice }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    getSelection: () => null,
    DOMParser: miniDom.DOMParser,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    FileReader: class { readAsDataURL() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1280, innerHeight: 800,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'app.js' });
  ctx.__db = client;
  ctx.__console = journal;
  ctx.__el = (id) => document.getElementById(id);
  ctx.__creer = (id) => { const el = elementInerte(id); elements.set(id, el); return el; };
  return ctx;
}

// Les let/const d'app.js ne sont pas sur le contexte : on passe par le code.
function injecter(ctx, valeurs) {
  ctx.__i = valeurs;
  vm.runInContext(Object.keys(valeurs).map((k) => `${k} = __i.${k};`).join('\n'), ctx);
  delete ctx.__i;
}
function lire(ctx, expression) { return vm.runInContext(expression, ctx); }
function horsContexte(x) { return JSON.parse(JSON.stringify(x)); }

// Retire les commentaires d'un source JS avant une garde qui le lit : un
// commentaire qui cite le defaut qu'il corrige ferait tomber la garde.
// Chaines, gabarits imbriques (${ `...` }) et regex litterales sont recopies
// tels quels (ils peuvent contenir // ou /*). Le canari de test/source.test.js
// verifie que le masquage n'efface pas de code.
const MOTS_AVANT_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'else', 'do']);
function sansCommentaires(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const pile = []; // profondeur d'accolades a retrouver en sortant d'un ${...}
  let prof = 0;
  let dernier = ''; // dernier caractere significatif en mode code
  let motPrec = '';
  const debutRegex = () => dernier === '' || '(,=:[!&|?{};+-*%<>~^'.includes(dernier) || MOTS_AVANT_REGEX.has(motPrec);
  function chaine(q) {
    out += src[i++];
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
      if (src[i] === '\n') return;
      out += src[i++];
    }
    if (i < n) out += src[i++];
  }
  function gabarit() { // rend 'expr' si un ${ s'ouvre, 'fin' sinon
    while (i < n) {
      const c = src[i];
      if (c === '\\') { out += c + (src[i + 1] ?? ''); i += 2; continue; }
      if (c === '`') { out += c; i++; return 'fin'; }
      if (c === '$' && src[i + 1] === '{') { out += '${'; i += 2; return 'expr'; }
      out += c; i++;
    }
    return 'fin';
  }
  function suiteGabarit() {
    if (gabarit() === 'expr') { pile.push(prof); prof = 0; dernier = '{'; motPrec = ''; } else { dernier = 'a'; motPrec = ''; }
  }
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const f = src.indexOf('*/', i + 2); i = f < 0 ? n : f + 2; out += ' '; continue; }
    if (c === '"' || c === "'") { chaine(c); dernier = 'a'; motPrec = ''; continue; }
    if (c === '`') { out += c; i++; suiteGabarit(); continue; }
    if (c === '/' && debutRegex()) {
      out += c; i++;
      let classe = false;
      while (i < n) {
        const r = src[i];
        if (r === '\\') { out += r + (src[i + 1] ?? ''); i += 2; continue; }
        if (r === '\n') break;
        if (r === '[') classe = true;
        else if (r === ']') classe = false;
        else if (r === '/' && !classe) { out += r; i++; break; }
        out += r; i++;
      }
      while (i < n && /[a-z]/i.test(src[i])) out += src[i++];
      dernier = 'a'; motPrec = ''; continue;
    }
    if (c === '}' && prof === 0 && pile.length) { out += c; i++; prof = pile.pop(); suiteGabarit(); continue; }
    if (c === '{') prof++;
    if (c === '}') prof--;
    if (/\s/.test(c)) { out += c; i++; continue; }
    if (/[A-Za-z_$0-9]/.test(c)) {
      let mot = '';
      while (i < n && /[A-Za-z_$0-9]/.test(src[i])) mot += src[i++];
      out += mot; dernier = 'a'; motPrec = mot; continue;
    }
    out += c; i++; dernier = c; motPrec = '';
  }
  return out;
}

module.exports = {
  RACINE, SOURCE_APP, SOURCE_HTML, IDS_HTML,
  charger, injecter, lire, horsContexte, faireDb, elementInerte, ChartFactice, sansCommentaires,
};
