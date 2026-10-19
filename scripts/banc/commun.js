'use strict';
// Socle commun du banc d'essai (banc.js : balayages ; mesures.js : chargement,
// mobile, captures). supabase-js est SUBSTITUÉ par faux-supabase.js avant
// app.js ; les integrity d'index.html sont retirés ; Chart.js est servi vrai.
//
// Modèle réseau « 4G lente » (option reseau) — inspiré de Lighthouse : 150 ms
// d'aller-retour, 1,6 Mbit/s descendant, poids compressés (gzip). Une nouvelle
// origine (CDN, Google Fonts) coûte un aller-retour de plus (connexion + TLS).
// Chaque requête Supabase simulée coûte un aller-retour. C'est un MODÈLE : il
// sert à comparer deux versions entre elles, pas à prédire la seconde près.

// Les données fictives (semaine courante, mois courant) se calculent à l'heure
// de Paris, comme le navigateur du banc : sinon, entre minuit et 2 h l'été, le
// générateur (UTC) et l'app (Paris) ne sont pas sur le même jour.
process.env.TZ = 'Europe/Paris';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { execSync } = require('node:child_process');

const DEPOT = path.join(__dirname, '..', '..');
const FAUX_SB = fs.readFileSync(path.join(__dirname, 'faux-supabase.js'), 'utf8');
const { donnees } = require('./donnees.js');

const RTT = 150; // ms
const DEBIT = 1.6e6 / 8; // octets par seconde

function resoudrePlaywright() {
  const candidats = ['playwright'];
  try { candidats.unshift(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (_) { /* rien */ }
  for (const p of candidats) { try { require.resolve(p); return require(p); } catch (_) { /* suivant */ } }
  throw new Error('Playwright introuvable (npm i -g playwright ou NODE_PATH)');
}

// Chart.js servi vrai : le fichier hébergé du dépôt, sinon BANC_VENDOR.
function cheminChart() {
  const local = path.join(DEPOT, 'vendor', 'chartjs-4.4.1', 'chart.umd.js');
  if (fs.existsSync(local)) return local;
  const v = process.env.BANC_VENDOR;
  if (v && fs.existsSync(path.join(v, 'package', 'dist', 'chart.umd.js'))) return path.join(v, 'package', 'dist', 'chart.umd.js');
  throw new Error('Chart.js 4.4.1 introuvable (vendor/ ou BANC_VENDOR)');
}
// Poids réel de supabase-js (le stub est minuscule : on facture le vrai poids).
function poidsGzSupabase() {
  const f = path.join(DEPOT, 'vendor', 'supabase-js-2.118.0', 'supabase.js');
  return fs.existsSync(f) ? zlib.gzipSync(fs.readFileSync(f)).length : 55000;
}

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain' };

// Sert les fichiers de `racine` (une autre version du site pour comparer).
function demarrerServeur(racine = process.env.BANC_RACINE || DEPOT) {
  const serveur = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/') url = '/index.html';
    const fichier = path.normalize(path.join(racine, url));
    if (!fichier.startsWith(path.normalize(racine)) || !fs.existsSync(fichier) || fs.statSync(fichier).isDirectory()) {
      res.writeHead(204); res.end(); return;
    }
    let corps = fs.readFileSync(fichier);
    if (url === '/index.html') corps = Buffer.from(corps.toString('utf8').replace(/\sintegrity="[^"]*"/g, ''));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream' });
    res.end(corps);
  });
  return new Promise((ok) => serveur.listen(0, '127.0.0.1', () => ok({ serveur, port: serveur.address().port, racine })));
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Options de contexte représentatives des utilisateurs : navigateur en français,
// fuseau de Paris (dates, semaines, mois affichés comme en vrai).
function optionsContexte(extra = {}) {
  return { locale: 'fr-FR', timezoneId: 'Europe/Paris', ...extra };
}

// PNG uni de la taille demandée (drapeaux flagcdn.com, tiers bloqué au banc) :
// un drapeau neutre à la bonne taille plutôt qu'une image cassée sur les captures.
function pngUni(l, h, [r, g, b] = [74, 82, 104]) {
  const crc = (buf) => zlib.crc32(buf) >>> 0;
  const morceau = (type, donnees) => {
    const t = Buffer.from(type); const lg = Buffer.alloc(4); lg.writeUInt32BE(donnees.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, donnees])));
    return Buffer.concat([lg, t, donnees, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const ligne = Buffer.concat([Buffer.from([0]), Buffer.alloc(l * 3).map((_, i) => [r, g, b][i % 3])]);
  const brut = Buffer.concat(Array.from({ length: h }, () => ligne));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), morceau('IHDR', ihdr), morceau('IDAT', zlib.deflateSync(brut)), morceau('IEND', Buffer.alloc(0))]);
}

// Branche le faux Supabase, les données fictives et le modèle réseau sur un
// contexte Playwright (toutes ses pages).
async function preparer(contexte, port, { piege, session = 'trader', reseau = false, journal } = {}) {
  const chart = fs.readFileSync(cheminChart());
  const gzChart = zlib.gzipSync(chart).length;
  const gzSb = poidsGzSupabase();
  const local = `http://127.0.0.1:${port}`;
  await contexte.route('**/*', async (route) => {
    const u = route.request().url();
    const externe = !u.startsWith(local);
    const delai = (gz) => (reseau ? (externe ? 2 : 1) * RTT + (gz / DEBIT) * 1000 : 0);
    const noter = (quoi, gz) => journal && journal.push({ url: u.replace(local, ''), quoi, gz, externe });
    if (/supabase-js|\/supabase\.js(\?|$)/.test(u) && !u.includes('faux-supabase')) {
      noter('supabase-js', gzSb); await attendre(delai(gzSb));
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAUX_SB });
    }
    if (/chart(\.umd)?\.js/i.test(u)) {
      noter('chart.js', gzChart); await attendre(delai(gzChart));
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: chart });
    }
    if (!externe) {
      const rep = await route.fetch();
      const corps = await rep.body();
      const gz = zlib.gzipSync(corps).length;
      noter('local', gz); await attendre(delai(gz));
      return route.fulfill({ response: rep, body: corps });
    }
    // Drapeaux (flagcdn.com) : PNG neutre à la taille demandée (« 24x18 »).
    const drapeau = /flagcdn\.com\/(\d+)x(\d+)\//.exec(u);
    if (drapeau) { noter('tiers', 0); return route.fulfill({ status: 200, contentType: 'image/png', body: pngUni(+drapeau[1], +drapeau[2]) }); }
    // Hôtes tiers (polices, iframe) : réponse vide, mais le coût réseau d'une
    // nouvelle origine est facturé pour les requêtes bloquantes.
    const bloquant = /fonts\.googleapis\.com/.test(u);
    noter(bloquant ? 'tiers-bloquant' : 'tiers', bloquant ? 900 : 0);
    if (bloquant) await attendre(delai(900));
    return route.fulfill({ status: 200, contentType: bloquant ? 'text/css' : 'text/plain', body: '' });
  });
  const sessions = {
    trader: { user: { id: 'auth-trader', email: 'trader@exemple.fr', app_metadata: { role: 'member' } } },
    admin: { user: { id: 'auth-admin', email: 'admin@exemple.fr', app_metadata: { role: 'super_admin' } } },
    aucune: null,
  };
  await contexte.addInitScript(({ d, s, lat }) => {
    window.__DONNEES = d; window.__SESSION = s; window.__LATENCE_MS = lat; window.__requetes = [];
  }, { d: donnees({ piege }), s: sessions[session], lat: reseau ? RTT : 0 });
}

const ECRANS = ['dashboard', 'currency', 'journal', 'calendar', 'macro', 'admin'];

async function allerEcran(page, ecran) {
  await page.evaluate((e) => {
    const tab = document.querySelector(`.nav-tab[data-s="${e}"]`);
    if (tab) tab.click();
  }, ecran);
  await page.waitForTimeout(250);
}

module.exports = { DEPOT, RTT, DEBIT, resoudrePlaywright, demarrerServeur, preparer, allerEcran, ECRANS, attendre, optionsContexte, pngUni };
