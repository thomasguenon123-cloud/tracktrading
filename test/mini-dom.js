'use strict';
// Mini-DOM pour le contexte node:vm : juste assez pour exercer sanitizeNotesHtml
// (DOMParser + document.createElement + manipulations d'arbre + (de)serialisation
// innerHTML avec entites). Les elements de getElementById restent inertes (voir
// charger-app.js) : seuls les noeuds createElement / DOMParser sont "reels".
// Pas un vrai navigateur — le banc Playwright reste la reference pour le rendu.

const VIDES = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);

function decoder(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e] ?? m;
  });
}
const encoderTexte = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const encoderAttr = (s) => encoderTexte(s).replace(/"/g, '&quot;');

function styleVersTexte(style) {
  const paires = [];
  for (const k of Object.keys(style)) {
    if (k.startsWith('_') || typeof style[k] === 'function' || style[k] === '' || style[k] == null) continue;
    const prop = k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    paires.push(`${prop}: ${style[k]}`);
  }
  return paires.join('; ');
}
function texteVersStyle(style, texte) {
  for (const k of Object.keys(style)) if (!k.startsWith('_') && typeof style[k] !== 'function') delete style[k];
  String(texte || '').split(';').forEach((d) => {
    const i = d.indexOf(':');
    if (i < 0) return;
    const prop = d.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const val = d.slice(i + 1).trim();
    if (prop) style[prop] = val;
  });
}

function faireStyle() {
  const style = {
    cssText: '',
    setProperty(p, v) { this[p.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; },
    removeProperty(p) { delete this[p.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; },
    getPropertyValue(p) { return this[p.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] || ''; },
  };
  Object.defineProperty(style, 'cssText', {
    get() { return styleVersTexte(this); },
    set(v) { texteVersStyle(this, v); },
    enumerable: false,
  });
  return style;
}

function faireClassList() {
  const s = new Set();
  return {
    add: (...c) => c.forEach((x) => x && s.add(x)),
    remove: (...c) => c.forEach((x) => s.delete(x)),
    toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; if (on) s.add(c); else s.delete(c); return on; },
    contains: (c) => s.has(c),
    get length() { return s.size; },
    toString: () => [...s].join(' '),
  };
}

class Noeud {
  constructor(type, tag) {
    this.nodeType = type;
    this.tagName = tag ? tag.toUpperCase() : undefined;
    this.childNodes = [];
    this.parentNode = null;
    this._attrs = new Map();
    this.style = faireStyle();
    this.classList = faireClassList();
    this.dataset = {};
    this.data = '';
    this._value = '';
    this.selected = false;
    this.checked = false;
  }
  // texte
  get textContent() {
    if (this.nodeType === 3) return this.data;
    return this.childNodes.map((n) => n.textContent).join('');
  }
  set textContent(v) { this.childNodes = []; if (v !== '' && v != null) this.appendChild(new Noeud(3)).data = String(v); }
  get value() { return this._value; }
  set value(v) { this._value = v == null ? '' : String(v); }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList = faireClassList(); String(v || '').split(/\s+/).forEach((c) => c && this.classList.add(c)); }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  // arbre
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    n.parentNode = this; return n;
  }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; } return n; }
  replaceChild(nw, old) { const i = this.childNodes.indexOf(old); if (i >= 0) { this.childNodes[i] = nw; nw.parentNode = this; old.parentNode = null; } return old; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  // attributs
  get attributes() {
    const out = [...this._attrs].map(([name, value]) => ({ name, value }));
    const st = styleVersTexte(this.style);
    if (st) out.push({ name: 'style', value: st });
    return out;
  }
  getAttribute(n) { if (n === 'style') { const st = styleVersTexte(this.style); return st || null; } return this._attrs.has(n) ? this._attrs.get(n) : null; }
  setAttribute(n, v) { if (n === 'style') texteVersStyle(this.style, v); else this._attrs.set(n, String(v)); }
  removeAttribute(n) { if (n === 'style') texteVersStyle(this.style, ''); else this._attrs.delete(n); }
  // conveniences inertes
  addEventListener() {} removeEventListener() {} dispatchEvent() { return true; }
  focus() {} blur() {} click() {}
  querySelector() { return null; } querySelectorAll() { return []; }
  closest() { return null; } matches() { return false; } contains(n) { return this.childNodes.includes(n); }
  getContext() { return new Proxy({}, { get: () => () => {} }); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  // (de)serialisation
  get innerHTML() { return this.childNodes.map(serialiser).join(''); }
  set innerHTML(html) { this.childNodes = []; analyser(String(html == null ? '' : html)).forEach((n) => this.appendChild(n)); }
  get outerHTML() { return serialiser(this); }
}

function serialiser(n) {
  if (n.nodeType === 3) return encoderTexte(n.data);
  const tag = n.tagName.toLowerCase();
  let attrs = '';
  for (const { name, value } of n.attributes) attrs += ` ${name}="${encoderAttr(value)}"`;
  if (VIDES.has(n.tagName)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${n.childNodes.map(serialiser).join('')}</${tag}>`;
}

function analyser(html) {
  const racine = new Noeud(1, 'ROOT');
  let cur = racine;
  const pile = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    if (html[i] === '<') {
      if (html[i + 1] === '!') { // commentaire / doctype : ignore
        const fin = html.indexOf('>', i); i = fin < 0 ? n : fin + 1; continue;
      }
      if (html[i + 1] === '/') { // fermeture
        const fin = html.indexOf('>', i);
        const nom = html.slice(i + 2, fin < 0 ? n : fin).trim().toUpperCase();
        for (let k = pile.length - 1; k >= 0; k--) {
          if (pile[k].tagName === nom) { pile.length = k; cur = pile[k - 1] || racine; break; }
        }
        i = fin < 0 ? n : fin + 1; continue;
      }
      const fin = html.indexOf('>', i);
      if (fin < 0) { cur.appendChild(new Noeud(3)).data = decoder(html.slice(i)); break; }
      let brut = html.slice(i + 1, fin);
      const autoferme = brut.endsWith('/');
      if (autoferme) brut = brut.slice(0, -1);
      const mNom = /^([a-zA-Z][\w-]*)/.exec(brut);
      if (!mNom) { cur.appendChild(new Noeud(3)).data = decoder(html.slice(i, fin + 1)); i = fin + 1; continue; }
      const el = new Noeud(1, mNom[1]);
      const reste = brut.slice(mNom[1].length);
      const reAttr = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
      let m;
      while ((m = reAttr.exec(reste))) {
        let v = m[2] ?? '';
        if (v && (v[0] === '"' || v[0] === "'")) v = v.slice(1, -1);
        el.setAttribute(m[1], decoder(v));
      }
      cur.appendChild(el);
      if (!autoferme && !VIDES.has(el.tagName)) { pile.push(el); cur = el; }
      i = fin + 1; continue;
    }
    const prochain = html.indexOf('<', i);
    const fin = prochain < 0 ? n : prochain;
    cur.appendChild(new Noeud(3)).data = decoder(html.slice(i, fin));
    i = fin;
  }
  return racine.childNodes.map((c) => { c.parentNode = null; return c; });
}

class DOMParser {
  parseFromString(html) {
    const doc = new Noeud(1, 'DOCUMENT');
    const body = new Noeud(1, 'BODY');
    body.innerHTML = String(html || '');
    doc.body = body;
    return doc;
  }
}

function createElement(tag) { return new Noeud(1, tag); }

module.exports = { Noeud, DOMParser, createElement, analyser, serialiser };
