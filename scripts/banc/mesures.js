'use strict';
// Mesures d'expérience (brief 1.8, 1.9, 5) — à rejouer AVANT et APRÈS une version :
//  A. chargement sous réseau « 4G lente » simulé (voir commun.js) :
//     - déconnecté : premier affichage (FCP) et formulaire de connexion visible ;
//     - connecté   : temps jusqu'au tableau de bord prêt, nombre de requêtes
//                    Supabase et « vagues » (requêtes qui s'attendent l'une l'autre) ;
//  B. iPhone 390 px / iPad 820 px en émulation TACTILE : débordement horizontal
//     (et ses coupables), cibles tactiles < 40 px, bouton visible au survol seul ;
//  C. captures d'écran (une page neuve par vue, mesure AVANT capture).
// Variables : BANC_RACINE (version servie), BANC_SORTIE (dossier), BANC_PREFIXE,
// BANC_REPETITIONS (médiane de N mesures de chargement).
// Lancement : npm run mesures

const fs = require('node:fs');
const path = require('node:path');
const { resoudrePlaywright, demarrerServeur, preparer, allerEcran, ECRANS, optionsContexte } = require('./commun.js');

const { chromium } = resoudrePlaywright();
const SORTIE = process.env.BANC_SORTIE || path.join(require('node:os').tmpdir(), 'tracktrading-mesures');
const PREFIXE = process.env.BANC_PREFIXE || 'mesure';
fs.mkdirSync(SORTIE, { recursive: true });

const PRET_APP = () => {
  const w = document.getElementById('app-wrap');
  return !!(w && w.classList.contains('ready') && !document.querySelector('#stats-row .spin')
    && document.querySelector('#j-list .tj-item, #j-list .empty')
    && window.Chart && Chart.getChart && Chart.getChart('balChart') && Chart.getChart('rrChart'));
};
// Formulaire VISIBLE = affiché ET mis en forme (styles.css appliqué : sans lui, le
// navigateur ne peint pas encore) ; UTILISABLE = app.js exécuté (boutons branchés).
const PRET_CONNEXION = () => {
  const c = document.querySelector('.auth-card');
  return !!(c && c.offsetParent !== null && getComputedStyle(c).display !== 'none'
    && getComputedStyle(c).borderTopWidth === '3px');
};
const CONNEXION_UTILISABLE = () => typeof window.bindAuthUI === 'function';
// Premier écran montré à quelqu'un de DÉJÀ connecté : le formulaire (qui clignote
// avant l'app) ou l'écran « Chargement de ton espace… ».
const ECRAN_INITIAL = () => {
  const vu = (el) => el && el.offsetParent !== null && getComputedStyle(el).display !== 'none'
    && getComputedStyle(el).visibility !== 'hidden';
  const c = document.querySelector('.auth-card');
  if (vu(c) && getComputedStyle(c).borderTopWidth === '3px') return 'formulaire de connexion';
  if (vu(document.getElementById('ecran-chargement'))) return 'écran de chargement';
  return '';
};

// Requêtes qui s'attendent : une requête lancée après la fin de la vague
// précédente ouvre une nouvelle vague.
function compterVagues(requetes) {
  const r = [...requetes].sort((a, b) => a.t0 - b.t0);
  let vagues = 0; let fin = -Infinity;
  for (const q of r) {
    if (q.t0 >= fin - 1) { vagues++; fin = q.t1; } else fin = Math.max(fin, q.t1);
  }
  return vagues;
}

async function mesurerChargement(navigateur, port) {
  const res = {};
  // Déconnecté
  {
    const journal = [];
    const ctx = await navigateur.newContext(optionsContexte({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }));
    await preparer(ctx, port, { session: 'aucune', reseau: true, journal });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' });
    await page.waitForFunction(PRET_CONNEXION, null, { polling: 20, timeout: 30000 });
    const formulaire = await page.evaluate(() => Math.round(performance.now()));
    await page.waitForFunction(CONNEXION_UTILISABLE, null, { polling: 20, timeout: 30000 });
    const utilisable = await page.evaluate(() => Math.round(performance.now()));
    const fcp = await page.evaluate(() => new Promise((ok) => {
      const lire = () => (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime;
      if (lire()) return ok(Math.round(lire()));
      new PerformanceObserver((l) => { const e = l.getEntriesByName('first-contentful-paint')[0]; if (e) ok(Math.round(e.startTime)); })
        .observe({ type: 'paint', buffered: true });
      setTimeout(() => ok(Math.round(lire() || -1)), 3000);
    }));
    // Visible = peint : jamais avant le premier affichage (FCP).
    const t = { formulaire: Math.max(formulaire, fcp), utilisable: Math.max(utilisable, fcp), fcp };
    res.deconnecte = { ...t, octetsGz: journal.reduce((s, j) => s + (j.gz || 0), 0), fichiers: journal.map((j) => j.url.split('?')[0]).filter((u) => !/flagcdn|favicon/.test(u)) };
    await ctx.close();
  }
  // Connecté (session en mémoire) : jusqu'au tableau de bord prêt
  {
    const journal = [];
    const ctx = await navigateur.newContext(optionsContexte({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }));
    await preparer(ctx, port, { session: 'trader', reseau: true, journal });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' });
    const ecranInitial = await (await page.waitForFunction(ECRAN_INITIAL, null, { polling: 'raf', timeout: 30000 })).jsonValue();
    await page.waitForFunction(PRET_APP, null, { polling: 20, timeout: 30000 });
    const t = await page.evaluate(() => ({ pret: Math.round(performance.now()), requetes: window.__requetes.slice() }));
    res.connecte = {
      ecranInitial,
      tableauDeBordPret: t.pret,
      requetesSupabase: t.requetes.length,
      vagues: compterVagues(t.requetes),
      detail: t.requetes.map((q) => `${Math.round(q.t0)}→${Math.round(q.t1)} ${q.quoi}`),
      octetsGz: journal.reduce((s, j) => s + (j.gz || 0), 0),
      erreurs,
    };
    await ctx.close();
  }
  return res;
}

// BANC_REPETITIONS=N : N mesures de chargement, on garde la MÉDIANE de chaque durée
// (le détail des requêtes est celui de la mesure médiane du tableau de bord).
async function mesurerChargementMedian(navigateur, port, n) {
  const essais = [];
  for (let i = 0; i < n; i++) essais.push(await mesurerChargement(navigateur, port));
  if (n === 1) return essais[0];
  const mediane = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const res = JSON.parse(JSON.stringify(essais[0]));
  for (const k of ['fcp', 'formulaire', 'utilisable']) res.deconnecte[k] = mediane(essais.map((e) => e.deconnecte[k]));
  const t = mediane(essais.map((e) => e.connecte.tableauDeBordPret));
  res.connecte = JSON.parse(JSON.stringify(essais.find((e) => e.connecte.tableauDeBordPret === t).connecte));
  res.repetitions = { n, tableauDeBordPret: essais.map((e) => e.connecte.tableauDeBordPret), fcp: essais.map((e) => e.deconnecte.fcp) };
  return res;
}

// Coupables d'un débordement : éléments qui dépassent alors que leur parent non.
const ANALYSER_DEBORDEMENT = () => {
  const h = document.documentElement.style.overflowX; const b = document.body.style.overflowX;
  document.documentElement.style.overflowX = 'visible'; document.body.style.overflowX = 'visible';
  const docW = document.documentElement.clientWidth;
  const scroll = document.documentElement.scrollWidth;
  const nom = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
  const coupables = [];
  const coupesAGauche = [];
  // Un élément dans un cadre qui défile (barre d'onglets, table admin) ne fait pas
  // déborder la page : ce n'est pas un coupable.
  const dansCadreDefilant = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const st = getComputedStyle(el);
    // Panneau fixe OUVERT plus large que l'écran : son bord gauche sort de l'écran.
    if (st.position === 'fixed' && r.left < -1 && r.right > 1 && st.visibility !== 'hidden' && st.display !== 'none') {
      coupesAGauche.push(`${nom(el)} (gauche ${Math.round(r.left)} px)`);
    }
    if (r.right <= docW + 1) continue;
    if (st.position === 'fixed' && r.left >= docW) continue; // panneau fermé hors écran
    if (dansCadreDefilant(el)) continue;
    const p = el.parentElement;
    const pr = p ? p.getBoundingClientRect() : { right: 0 };
    if (pr.right <= docW + 1 || p === document.body) coupables.push(`${nom(el)} (droite ${Math.round(r.right)} px)`);
  }
  document.documentElement.style.overflowX = h; document.body.style.overflowX = b;
  return { docW, scroll, deborde: scroll > docW + 1 || coupesAGauche.length > 0, coupables: coupables.slice(0, 6), coupesAGauche };
};
const CIBLES = () => {
  const sel = 'button, a[href], select, input:not([type=hidden]), [onclick], .nav-tab, .acc-tab, .tj-hdr, .user-btn';
  let total = 0; let petites = 0; let tresPetites = 0;
  const exemples = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('[hidden]')) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    if (r.bottom < 0 || r.top > innerHeight * 3) continue;
    total++;
    // Case/bouton radio avec libellé : le libellé aussi déclenche (cible = l'ensemble).
    let rect = r;
    if (/^(radio|checkbox)$/.test(el.type) && el.labels && el.labels.length) {
      const rs = [r, ...[...el.labels].map((l) => l.getBoundingClientRect())];
      rect = { width: Math.max(...rs.map((x) => x.right)) - Math.min(...rs.map((x) => x.left)),
        height: Math.max(...rs.map((x) => x.bottom)) - Math.min(...rs.map((x) => x.top)) };
    }
    const m = Math.min(rect.width, rect.height);
    if (m < 40) {
      petites++;
      if (exemples.length < 8) exemples.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''}[${(el.textContent || el.getAttribute('type') || '').trim().slice(0, 18)}] ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    if (m < 28) tresPetites++;
  }
  return { total, petites, tresPetites, exemples };
};

async function mesurerAppareil(navigateur, port, { largeur, hauteur, nom, captures }) {
  const vues = [...ECRANS.map((e) => ({ ecran: e })), { ecran: 'dashboard', etat: 'detail-trade' }, { ecran: 'journal', etat: 'modal-trade' }, { ecran: 'currency', etat: 'bilan' }];
  const out = [];
  for (const v of vues) {
    const ctx = await navigateur.newContext(optionsContexte({ viewport: { width: largeur, height: hauteur }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }));
    await preparer(ctx, port, { session: 'admin' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(PRET_APP, null, { polling: 50, timeout: 30000 }).catch(() => {});
    await allerEcran(page, v.ecran);
    if (v.etat === 'detail-trade') await page.evaluate(() => window.showTradeDetailById && window.showTradeDetailById('t1'));
    if (v.etat === 'modal-trade') await page.evaluate(() => window.openTrade && window.openTrade('t1'));
    if (v.etat === 'bilan') await page.evaluate(() => { const b = document.querySelector('#rpt-cur-btns [data-cur="BILAN"]'); if (b) b.click(); });
    await page.waitForTimeout(500);
    const deb = await page.evaluate(ANALYSER_DEBORDEMENT);
    const cibles = await page.evaluate(CIBLES);
    let survolSeul = null;
    if (v.ecran === 'currency' && !v.etat) {
      survolSeul = await page.evaluate(() => {
        const rm = document.querySelector('.cur-paste-zone-v2.has-img .cur-paste-rm');
        return rm ? getComputedStyle(rm).display : 'aucune image';
      });
    }
    const id = v.ecran + (v.etat ? '-' + v.etat : '');
    if (captures) await page.screenshot({ path: path.join(SORTIE, `${PREFIXE}-${largeur}-${id}.png` ) });
    out.push({ vue: id, ...deb, cibles, ...(survolSeul ? { boutonSupprimerImage: survolSeul } : {}) });
    await ctx.close();
  }
  return { appareil: nom, largeur, vues: out };
}

(async () => {
  const { serveur, port, racine } = await demarrerServeur();
  const navigateur = await chromium.launch();
  const rapport = { version: racine, date: new Date().toISOString() };
  try {
    rapport.chargement = await mesurerChargementMedian(navigateur, port, Math.max(1, +process.env.BANC_REPETITIONS || 1));
    rapport.iphone = await mesurerAppareil(navigateur, port, { largeur: 390, hauteur: 844, nom: 'iPhone', captures: true });
    rapport.ipad = await mesurerAppareil(navigateur, port, { largeur: 820, hauteur: 1180, nom: 'iPad', captures: false });
  } finally {
    await navigateur.close();
    serveur.close();
  }
  fs.writeFileSync(path.join(SORTIE, `${PREFIXE}.json`), JSON.stringify(rapport, null, 2));
  const c = rapport.chargement;
  console.log('== MESURES (' + PREFIXE + ') ==');
  console.log(`déconnecté : FCP ${c.deconnecte.fcp} ms · formulaire visible ${c.deconnecte.formulaire} ms · utilisable ${c.deconnecte.utilisable} ms · ${Math.round(c.deconnecte.octetsGz / 1024)} Ko gz`);
  console.log(`connecté   : 1er écran « ${c.connecte.ecranInitial} » · tableau de bord prêt ${c.connecte.tableauDeBordPret} ms · ${c.connecte.requetesSupabase} requêtes en ${c.connecte.vagues} vagues · ${Math.round(c.connecte.octetsGz / 1024)} Ko gz · erreurs ${c.connecte.erreurs.length}`);
  for (const a of [rapport.iphone, rapport.ipad]) {
    const deb = a.vues.filter((v) => v.deborde);
    console.log(`${a.appareil} ${a.largeur} px : débordement sur ${deb.length}/${a.vues.length} vues ${deb.map((v) => v.vue + '(' + v.scroll + ')').join(' ')}`);
    const p = a.vues.reduce((s, v) => s + v.cibles.petites, 0); const t = a.vues.reduce((s, v) => s + v.cibles.total, 0);
    console.log(`   cibles tactiles < 40 px : ${p}/${t}`);
    const ex = [...new Set(a.vues.flatMap((v) => v.cibles.exemples || []))].slice(0, 12);
    if (ex.length) console.log('     ex. ' + ex.join(' | '));
    const sup = a.vues.find((v) => v.boutonSupprimerImage); if (sup) console.log(`   bouton « Supprimer » une image (sans survol) : display=${sup.boutonSupprimerImage}`);
  }
  console.log('détail :', path.join(SORTIE, `${PREFIXE}.json`));
})().catch((e) => { console.error(e); process.exit(2); });
