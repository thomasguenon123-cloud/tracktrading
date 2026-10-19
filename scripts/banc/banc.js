'use strict';
// Banc d'essai navigateur (brief 1.8) — balayages à rejouer après tout nouvel écran :
//  - clics de chaque écran (erreurs console / pageerror) ;
//  - XSS de tous les champs de texte libre (marqueur INERTE <tt-xss>, aucun script) ;
//  - débordement iPhone 390 / iPad 820 (filet overflow-x neutralisé) : depuis la
//    v=5, un débordement fait ÉCHOUER le banc (garde du mobile, UX-01).
// Aucune vraie donnée. Lancement : npm run banc   (mesures : npm run mesures)

const { resoudrePlaywright, demarrerServeur, preparer, allerEcran, ECRANS, optionsContexte } = require('./commun.js');

const { chromium } = resoudrePlaywright();

const CHAMPS_LIBRES = new Set([
  'trades.instrument', 'trades.strategy', 'trades.setup_type', 'trades.analysis_notes', 'trades.entry_notes',
  'trades.management_notes', 'trades.lessons', 'workspaces.name', 'users.name', 'users.name#2',
  'allowed_emails.note', 'allowed_emails.display_name', 'currency_report_entries.notes',
  'trade_images.filename', 'trade_images.filename#2', 'currency_report_images.filename', 'accounts.name',
]);
// Marqueur inerte : AUCUN script. S'il apparaît comme élément <tt-xss> dans le
// DOM, le champ n'a pas été échappé.
const MARQUEUR = (champ) => `"><tt-xss data-champ="${champ.replace(/[^a-z_#.0-9]/gi, '')}"></tt-xss>`;

async function balayerClics(page) {
  let clics = 0;
  for (const ecran of ECRANS) {
    await allerEcran(page, ecran);
    const sel = `#sec-${ecran} button, #sec-${ecran} [onclick], #sec-${ecran} .acc-tab, #sec-${ecran} .nav-tab, #sec-${ecran} .modal-tab`;
    const n = await page.locator(sel).count();
    for (let i = 0; i < n; i++) {
      const el = page.locator(sel).nth(i);
      try {
        if (!(await el.isVisible())) continue;
        await el.click({ timeout: 800, force: true });
        clics++;
        await page.waitForTimeout(12);
        await page.keyboard.press('Escape').catch(() => {});
        await page.evaluate(() => {
          document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => o.classList.add('hidden'));
          if (window.closeTrade) window.closeTrade();
          if (window.closeConfirm) window.closeConfirm();
        });
      } catch (_) { /* élément détaché après re-rendu : ignoré */ }
    }
  }
  return clics;
}

async function mesurerDebordement(page, largeur, hauteur) {
  await page.setViewportSize({ width: largeur, height: hauteur });
  const resultats = [];
  for (const ecran of ECRANS) {
    await allerEcran(page, ecran);
    const r = await page.evaluate(() => {
      const h = document.documentElement.style.overflowX; const b = document.body.style.overflowX;
      document.documentElement.style.overflowX = 'visible'; document.body.style.overflowX = 'visible';
      const docW = document.documentElement.clientWidth;
      const scroll = document.documentElement.scrollWidth;
      document.documentElement.style.overflowX = h; document.body.style.overflowX = b;
      return { docW, scroll };
    });
    resultats.push({ ecran, deborde: r.scroll > r.docW + 1, scroll: r.scroll, docW: r.docW });
  }
  return resultats;
}

async function balayerXss(navigateur, port) {
  const contexte = await navigateur.newContext(optionsContexte({ viewport: { width: 1280, height: 800 } }));
  await preparer(contexte, port, { piege: (champ) => (CHAMPS_LIBRES.has(champ) ? MARQUEUR(champ) : 'Texte ' + champ), session: 'admin' });
  const page = await contexte.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const fuites = new Set();
  for (const ecran of ECRANS) {
    await allerEcran(page, ecran);
    if (ecran === 'journal') {
      const n = await page.locator('#j-list .tj-hdr').count();
      for (let i = 0; i < n; i++) await page.locator('#j-list .tj-hdr').nth(i).click({ force: true }).catch(() => {});
      await page.waitForTimeout(150);
    }
    if (ecran === 'dashboard') {
      await page.evaluate(() => { if (window.showTradeDetailById) window.showTradeDetailById('t1'); });
      await page.waitForTimeout(150);
    }
    (await page.$$eval('tt-xss', (els) => els.map((e) => e.getAttribute('data-champ')))).forEach((c) => fuites.add(c || '?'));
  }
  await contexte.close();
  return [...fuites];
}

(async () => {
  const { serveur, port } = await demarrerServeur();
  const navigateur = await chromium.launch();
  const rapport = { clics: 0, erreursConsole: [], pageerror: [], fuitesXss: [], debordement390: [], debordement820: [] };
  try {
    const contexte = await navigateur.newContext(optionsContexte({ viewport: { width: 1280, height: 800 } }));
    await preparer(contexte, port, { session: 'admin' });
    const page = await contexte.newPage();
    page.on('console', (m) => { if (m.type() === 'error') rapport.erreursConsole.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => rapport.pageerror.push((e.message || String(e)).slice(0, 200)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    rapport.clics = await balayerClics(page);
    rapport.debordement390 = (await mesurerDebordement(page, 390, 844)).filter((r) => r.deborde);
    rapport.debordement820 = (await mesurerDebordement(page, 820, 1180)).filter((r) => r.deborde);
    await contexte.close();
    rapport.fuitesXss = await balayerXss(navigateur, port);
  } finally {
    await navigateur.close();
    serveur.close();
  }
  console.log(JSON.stringify(rapport, null, 2));
  console.log('\n== BANC ==');
  console.log('clics rejoués        :', rapport.clics);
  console.log('erreurs console      :', rapport.erreursConsole.length);
  console.log('pageerror            :', rapport.pageerror.length);
  console.log('fuites XSS           :', rapport.fuitesXss.length, rapport.fuitesXss.join(', '));
  console.log('débordement iPhone   :', rapport.debordement390.map((r) => r.ecran + ' (' + r.scroll + 'px)').join(', ') || 'aucun');
  console.log('débordement iPad     :', rapport.debordement820.map((r) => r.ecran + ' (' + r.scroll + 'px)').join(', ') || 'aucun');
  // v=5 : le mobile est une garde (UX-01) — tout débordement fait échouer le banc.
  const ok = rapport.pageerror.length === 0 && rapport.fuitesXss.length === 0
    && rapport.debordement390.length === 0 && rapport.debordement820.length === 0;
  console.log(ok ? 'BANC OK' : 'BANC EN ÉCHEC');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
