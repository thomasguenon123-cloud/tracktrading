'use strict';
// Banc d'essai navigateur (brief 1.8). Chromium pré-installé + Playwright.
//  - supabase-js est SUBSTITUÉ avant app.js (on intercepte la requête CDN et on
//    sert scripts/banc/faux-supabase.js : données injectées, écritures dans
//    window.__appels) ;
//  - les integrity d'index.html sont retirés (le stub n'en a pas) ;
//  - Chart.js est servi VRAI depuis vendor-banc (empreinte réelle) ;
//  - balayages : clics de chaque écran (erreurs console/pageerror), XSS de tous
//    les champs de texte libre, débordement iPhone 390 / iPad 820 px.
// Aucune vraie donnée. Lancement : node scripts/banc/banc.js

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(resoudrePlaywright());

const RACINE = path.join(__dirname, '..', '..');
const SCRATCH = process.env.BANC_VENDOR || path.join('/tmp/claude-0/-home-user-tracktrading/b4a8910a-f6f9-5971-b5d6-91c177685dcb/scratchpad', 'vendor-banc');
const CHART = path.join(SCRATCH, 'package', 'dist', 'chart.umd.js');
const { donnees } = require('./donnees.js');
const FAUX_SB = fs.readFileSync(path.join(__dirname, 'faux-supabase.js'), 'utf8');

function resoudrePlaywright() {
  for (const p of [path.join(require('node:child_process').execSync('npm root -g').toString().trim(), 'playwright'), 'playwright']) {
    try { require.resolve(p); return p; } catch (_) { /* suivant */ }
  }
  return 'playwright';
}

// Petit serveur : sert index.html (integrity retirés), app.js, styles.css, le
// stub, Chart.js vrai ; tout le reste → 204 (flagcdn, polices, iframe…).
function demarrerServeur() {
  const fichiers = {
    '/index.html': () => fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8').replace(/\sintegrity="[^"]*"/g, ''),
    '/app.js': () => fs.readFileSync(path.join(RACINE, 'app.js'), 'utf8'),
    '/styles.css': () => fs.readFileSync(path.join(RACINE, 'styles.css'), 'utf8'),
    '/faux-supabase.js': () => FAUX_SB,
    '/chart.umd.js': () => fs.readFileSync(CHART, 'utf8'),
  };
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
  const serveur = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const nom = url === '/' ? '/index.html' : url;
    if (fichiers[nom]) {
      res.writeHead(200, { 'Content-Type': types[path.extname(nom)] || 'text/plain' });
      res.end(fichiers[nom]());
    } else { res.writeHead(204); res.end(); }
  });
  return new Promise((ok) => serveur.listen(0, () => ok({ serveur, port: serveur.address().port })));
}

const ECRANS = ['dashboard', 'currency', 'journal', 'calendar', 'macro', 'admin'];
const CHAMPS_LIBRES = new Set([
  'trades.instrument', 'trades.strategy', 'trades.setup_type', 'trades.analysis_notes', 'trades.entry_notes',
  'trades.management_notes', 'trades.lessons', 'workspaces.name', 'users.name', 'users.name#2',
  'allowed_emails.note', 'allowed_emails.display_name', 'currency_report_entries.notes',
  'trade_images.filename', 'trade_images.filename#2', 'currency_report_images.filename', 'accounts.name',
]);
// Marqueur inerte : AUCUN script. S'il apparaît comme élément <tt-xss> dans le
// DOM, le champ n'a pas été échappé.
const MARQUEUR = (champ) => `"><tt-xss data-champ="${champ.replace(/[^a-z_#.0-9]/gi, '')}"></tt-xss>`;

async function preparer(page, port, { piege } = {}) {
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (/supabase-js(@\d|\.js|\/dist)|supabase\.js/.test(u) && !u.includes('/faux-supabase.js')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAUX_SB });
    }
    if (/cdnjs|chart\.umd\.js/i.test(u) && /chart/i.test(u)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(CHART, 'utf8') });
    }
    if (u.startsWith(`http://127.0.0.1:${port}`)) return route.continue();
    return route.fulfill({ status: 204, body: '' }); // flagcdn, polices, iframe investing…
  });
  await page.addInitScript((d) => {
    window.__DONNEES = d;
    window.__SESSION = { user: { id: 'auth-trader', email: 'trader@exemple.fr', app_metadata: { role: 'member' } } };
  }, donnees({ piege }));
}

async function allerEcran(page, ecran) {
  await page.evaluate((e) => {
    document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
    const tab = document.querySelector(`.nav-tab[data-s="${e}"]`);
    if (tab) tab.click();
  }, ecran);
  await page.waitForTimeout(250);
}

async function balayerClics(page, erreurs) {
  let clics = 0;
  for (const ecran of ECRANS) {
    await allerEcran(page, ecran);
    const sel = `#sec-${ecran} button, #sec-${ecran} [onclick], #sec-${ecran} .acc-tab, #sec-${ecran} .nav-tab, #sec-${ecran} .modal-tab`;
    const n = await page.locator(sel).count();
    for (let i = 0; i < n; i++) {
      const el = page.locator(sel).nth(i);
      try {
        if (!(await el.isVisible())) continue;
        await el.click({ timeout: 800, trial: false, force: true });
        clics++;
        await page.waitForTimeout(12);
        // Refermer un éventuel modal/panneau pour ne pas masquer les suivants.
        await page.keyboard.press('Escape').catch(() => {});
        await page.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => o.classList.add('hidden')); if (window.closeTrade) window.closeTrade(); if (window.closeConfirm) window.closeConfirm(); });
      } catch (_) { /* élément détaché après re-render : ignoré */ }
    }
  }
  return clics;
}

async function mesurerDebordement(page, largeur, hauteur) {
  await page.setViewportSize({ width: largeur, height: hauteur });
  const resultats = [];
  for (const ecran of ECRANS) {
    await allerEcran(page, ecran);
    // On neutralise le filet overflow-x:clip pour voir ce qui dépasse vraiment.
    const r = await page.evaluate(() => {
      const prevH = document.documentElement.style.overflowX; const prevB = document.body.style.overflowX;
      document.documentElement.style.overflowX = 'visible'; document.body.style.overflowX = 'visible';
      const docW = document.documentElement.clientWidth;
      let pire = null;
      document.querySelectorAll('#app-wrap *').forEach((el) => {
        const w = el.getBoundingClientRect().width;
        if (el.scrollWidth > docW + 1 && (!pire || el.scrollWidth > pire.sw)) {
          pire = { sw: el.scrollWidth, w: Math.round(w), tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 40), id: el.id };
        }
      });
      const scroll = document.documentElement.scrollWidth;
      document.documentElement.style.overflowX = prevH; document.body.style.overflowX = prevB;
      return { docW, scroll, pire };
    });
    resultats.push({ ecran, deborde: r.scroll > r.docW + 1, scroll: r.scroll, docW: r.docW, coupable: r.pire });
  }
  return resultats;
}

async function balayerXss(page, port) {
  await preparer(page, port, { piege: (champ) => (CHAMPS_LIBRES.has(champ) ? MARQUEUR(champ) : 'Texte ' + champ) });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const fuites = new Set();
  for (const ecran of ECRANS) {
    await allerEcran(page, ecran);
    // Déplier chaque trade du journal (le contenu est rendu au dépli).
    if (ecran === 'journal') {
      const hdrs = await page.locator('#j-list .tj-hdr').count();
      for (let i = 0; i < hdrs; i++) { await page.locator('#j-list .tj-hdr').nth(i).click({ force: true }).catch(() => {}); }
      await page.waitForTimeout(150);
    }
    if (ecran === 'dashboard') {
      // Ouvre le détail d'un trade (clic programmatique sur une barre).
      await page.evaluate(() => { if (window.showTradeDetailById) window.showTradeDetailById('t1'); });
      await page.waitForTimeout(100);
    }
    (await page.$$eval('tt-xss', (els) => els.map((e) => e.getAttribute('data-champ')))).forEach((c) => fuites.add(c || '?'));
  }
  return [...fuites];
}

(async () => {
  if (!fs.existsSync(CHART)) { console.error('Chart.js introuvable dans', CHART, '— lancer d abord la préparation vendor.'); process.exit(2); }
  const { serveur, port } = await demarrerServeur();
  const navigateur = await chromium.launch();
  const rapport = { clics: 0, erreursConsole: [], pageerror: [], fuitesXss: [], debordement390: [], debordement820: [] };
  try {
    const page = await navigateur.newPage({ viewport: { width: 1280, height: 800 } });
    const erreurs = rapport;
    page.on('console', (m) => { if (m.type() === 'error') erreurs.erreursConsole.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => erreurs.pageerror.push((e.message || String(e)).slice(0, 200)));

    await preparer(page, port);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    rapport.clics = await balayerClics(page, erreurs);
    rapport.debordement390 = (await mesurerDebordement(page, 390, 844)).filter((r) => r.deborde);
    rapport.debordement820 = (await mesurerDebordement(page, 820, 1180)).filter((r) => r.deborde);
    await page.close();

    const pageXss = await navigateur.newPage({ viewport: { width: 1280, height: 800 } });
    rapport.fuitesXss = await balayerXss(pageXss, port);
    await pageXss.close();
  } finally {
    await navigateur.close();
    serveur.close();
  }
  console.log(JSON.stringify(rapport, null, 2));
  const ok = rapport.pageerror.length === 0 && rapport.fuitesXss.length === 0;
  console.log('\n== BANC ==');
  console.log('clics rejoués        :', rapport.clics);
  console.log('erreurs console      :', rapport.erreursConsole.length);
  console.log('pageerror            :', rapport.pageerror.length);
  console.log('fuites XSS           :', rapport.fuitesXss.length, rapport.fuitesXss.join(', '));
  console.log('débordement iPhone   :', rapport.debordement390.map((r) => r.ecran + ' (' + r.scroll + 'px)').join(', ') || 'aucun');
  console.log('débordement iPad     :', rapport.debordement820.map((r) => r.ecran + ' (' + r.scroll + 'px)').join(', ') || 'aucun');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
