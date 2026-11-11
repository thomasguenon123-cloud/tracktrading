'use strict';
// (module d'aide, pas de test)
// Aides de test/honnete-rapports-revue.test.js (revue adverse v=6, Rapports),
// copiées de test/honnete-rapports-sauvegarde.test.js.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, lire, injecter, faireDb, horsContexte, RACINE, SOURCE_APP, sansCommentaires } = require('./charger-app.js');

const tour = () => new Promise((r) => setImmediate(r));
async function laisserFiler(n = 12) { for (let i = 0; i < n; i++) await tour(); }

const LUNDI = '2026-10-19T10:00:00+02:00'; // lundi 19/10/2026, 10 h à Paris

// Base de rapports fictive : un rapport par semaine (clé = week_start), des
// entrées par devise, des captures par entrée. `panne['table:op']` (booléen ou
// fonction de l'état de la requête) fait échouer l'opération ; `guichet` garde
// chaque réponse en vol jusqu'à ce que le test la serve (db.enAttente).
function baseRapports({ semaines, panne = {}, guichet = false } = {}) {
  const donnees = semaines || {
    '2026-10-19': { id: 'r1', ws: 'ws-a', entrees: [{ id: 'e1', currency: 'USD', bias: 'bullish', notes: 'note en base', images: [] }] },
  };
  const lectures = [];
  const enAttente = [];
  const f = (etat, c) => (etat.filtres.find((x) => x[1] === c) || [])[2];
  const refus = (nom, etat) => {
    const p = panne[nom + ':' + etat.op];
    return typeof p === 'function' ? p(etat) : !!p;
  };
  const rapports = () => Object.entries(donnees).map(([w, r]) => ({ week_start: r.semaine || w, ...r }));
  function repondre(nom, etat) {
    if (refus(nom, etat)) return { data: null, error: { message: 'refus' } };
    if (etat.op === 'select') lectures.push([nom, horsContexte(etat.filtres)]);
    if (nom === 'currency_reports') {
      if (etat.op === 'insert') return { data: { id: 'r-neuf' }, error: null };
      if (etat.op !== 'select') return { data: null, error: null };
      const r = rapports().find((x) => x.week_start === f(etat, 'week_start') && (!f(etat, 'workspace_id') || x.ws === f(etat, 'workspace_id')));
      if (!r) return { data: null, error: null };
      return { data: { id: r.id, week_start: r.week_start, currency_report_entries: r.entrees.map((e) => ({ ...e, currency_report_images: e.images || [] })) }, error: null };
    }
    if (nom === 'currency_report_entries') {
      if (etat.op === 'insert') return { data: { id: 'e-neuf' }, error: null };
      if (etat.op !== 'select') return { data: null, error: null };
      const r = rapports().find((x) => x.id === f(etat, 'report_id'));
      const e = r && r.entrees.find((x) => x.currency === f(etat, 'currency'));
      return { data: e ? { id: e.id, bias: e.bias, notes: e.notes } : null, error: null };
    }
    if (nom === 'currency_report_images') {
      if (etat.op !== 'select') return { data: null, error: null };
      const e = rapports().flatMap((r) => r.entrees).find((x) => x.id === f(etat, 'entry_id'));
      return { data: ((e && e.images) || []).filter((i) => i.image_type === f(etat, 'image_type')), error: null };
    }
    return { data: [], error: null };
  }
  let db = null;
  const reponses = new Proxy({}, {
    get: (_, nom) => (etat) => {
      if (!db.guichet) return repondre(String(nom), etat);
      return new Promise((ok) => enAttente.push({ nom: String(nom), etat, servir: () => ok(repondre(String(nom), etat)) }));
    },
  });
  db = faireDb({ reponses });
  return Object.assign(db, { lectures, enAttente, donnees, panne, guichet });
}
// Sert les requêtes en vol une par une (la plus ancienne d'abord, ou la plus
// récente avec dernierDabord), jusqu'à ce qu'il n'y en ait plus.
async function servirTout(db, { dernierDabord = false } = {}) {
  await laisserFiler();
  while (db.enAttente.length) { (dernierDabord ? db.enAttente.pop() : db.enAttente.shift()).servir(); await laisserFiler(); }
}
// Ouvre l'onglet Rapports sur la semaine donnée (lundi 19/10 par défaut).
async function ouvrirRapports(db, { maintenant, semaine = '2026-10-19', ...opts } = {}) {
  const ctx = charger({ maintenant: maintenant || new Date(LUNDI), db, muet: true, ...opts });
  const S = lire(ctx, 'S');
  S.workspaceId = 'ws-a'; S.currentWorkspaceId = 'ws-a';
  ctx.__el('rpt-week').value = semaine;
  await ctx.loadCurrencyReport();
  return ctx;
}
// Lecture de fichier immédiate (le FileReader du harnais ne rappelle jamais).
class LecteurImmediat { readAsDataURL(f) { setImmediate(() => this.onload({ target: { result: 'data:image/png;base64,' + (f.name || 'X') } })); } }
const ecritures = (db, table, op) => db.appels.filter((a) => a.table === table && (!op || a.op === op));
const notesEcrites = (db) => ecritures(db, 'currency_report_entries').map((a) => a.charge.notes);
const indicateur = (ctx) => ctx.__el('autosave-indicator');

function stockageFictif(db, { refuserEnvoi = false, refuserLien = () => false } = {}) {
  db.storage.from = () => ({
    upload: async (chemin) => {
      db.appels.push({ table: 'storage', op: 'upload', charge: chemin });
      return refuserEnvoi ? { data: null, error: { message: 'The object exceeded the maximum allowed size' } } : { data: {}, error: null };
    },
    remove: async (chemins) => { db.appels.push({ table: 'storage', op: 'remove', charge: horsContexte(chemins) }); return { data: [], error: null }; },
    createSignedUrl: async (chemin) => { db.unitaires.push(chemin); return { data: { signedUrl: 'https://exemple.invalid/signe/' + chemin }, error: null }; },
    createSignedUrls: async (chemins) => { // l'URL porte le numéro du lot
      db.signatures.push([...chemins]);
      const lot = db.signatures.length;
      return { data: chemins.map((p) => (refuserLien(p)
        ? { path: p, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' }
        : { path: p, signedUrl: 'https://exemple.invalid/signe/' + p + '?lot=' + lot, error: null })), error: null };
    },
  });
}
function listeSemaines(ctx) {
  const el = ctx.__creer('rpt-week-btns');
  Object.defineProperty(el, 'lastElementChild', { get() { return this.children[this.children.length - 1] || null; } });
  let html = '';
  Object.defineProperty(el, 'innerHTML', { get: () => html, set(v) { html = String(v); if (!html) this.children.length = 0; } });
  return el;
}

function servir(db, choix) {
  const i = db.enAttente.findIndex(choix);
  assert.ok(i >= 0, 'requête attendue en vol');
  db.enAttente.splice(i, 1)[0].servir();
}
const lectureDu = (semaine) => (q) => q.nom === 'currency_reports' && q.etat.op === 'select'
  && q.etat.filtres.some((f) => f[1] === 'week_start' && f[2] === semaine);

const boutonsSemaine = (ctx) => ctx.__el('rpt-week-btns').children;
const semainesActives = (ctx) => boutonsSemaine(ctx).filter((b) => b.classList.contains('active')).map((b) => b.dataset.week);
module.exports = { charger, lire, injecter, faireDb, horsContexte, RACINE, SOURCE_APP, sansCommentaires, tour, laisserFiler, LUNDI,
  baseRapports, servirTout, ouvrirRapports, LecteurImmediat, ecritures, notesEcrites, indicateur, stockageFictif, listeSemaines,
  servir, lectureDu, boutonsSemaine, semainesActives, assert };
