#!/usr/bin/env python3
"""Rejoue toutes les mutations : chaque garde de test/ doit TOMBER quand on
reintroduit le defaut qu'elle surveille. Lancer : python3 scripts/mutations.py
Ajouter une ligne ici a chaque nouvelle garde (brief 1.5)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from muter import muter  # noqa: E402

D, S, R, SRC, C = 'test/dates.test.js', 'test/stats.test.js', 'test/rendu.test.js', 'test/source.test.js', 'test/charger.test.js'
E = 'test/echappement.test.js'
DEP = 'test/dependances.test.js'
DEM, MOB = 'test/demarrage.test.js', 'test/mobile.test.js'
CHART_SRI = 'sha384-dug+JxfBvklEQdJ4AYuBBAIScUz0bVN73xpy273gcAwHjb3qI0fXmuYNaNfdyYJG'

MUTATIONS = [
    # nom, fichier, test, ancien, nouveau
    ('date du jour en UTC dans Nouveau Trade', 'app.js', D,
     "document.getElementById('m-date').value=fmtYMD(new Date());",
     "document.getElementById('m-date').value=new Date().toISOString().slice(0,10);"),
    ('fmtYM en UTC', 'app.js', D,
     "function fmtYM(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}",
     "function fmtYM(d){return d.toISOString().slice(0,7);}"),
    ('semaine des rapports commencant le dimanche', 'app.js', D,
     "mon.setDate(now.getDate()-(day===0?6:day-1));", "mon.setDate(now.getDate()-day);"),
    ('semaine du calendrier commencant le dimanche', 'app.js', D,
     "const mondayOffset = (dow === 0 ? -6 : 1 - dow);", "const mondayOffset = -dow;"),
    ('taux de reussite sans les BE au denominateur', 'app.js', S,
     "const winRate=closed.length>0?(wins/closed.length)*100:0;",
     "const winRate=(wins+losses)>0?(wins/(wins+losses))*100:0;"),
    ('trades BE retires de la courbe', 'app.js', S,
     "const sorted=trades.filter(t=>t.status==='closed')",
     "const sorted=trades.filter(t=>t.status==='closed'&&(+t.actual_rr||0)!==0)"),
    ('trades annules dans la selection par mois', 'app.js', S,
     "return keys.includes(k)&&t.status!=='cancelled';", "return keys.includes(k);"),
    ('instrument non echappe dans le journal', 'app.js', R,
     "font-size:12px;color:var(--text)\">${esc(t.instrument)}</span>",
     "font-size:12px;color:var(--text)\">${t.instrument}</span>"),
    ('nom du trader non echappe dans le journal', 'app.js', R,
     "border:1px solid ${uColor}44\">${esc(uName)}</span>", "border:1px solid ${uColor}44\">${uName}</span>"),
    ('notes d entree non echappees', 'app.js', R,
     "${esc(t.entry_notes).replace(/\\n/g,'<br>')}", "${t.entry_notes.replace(/\\n/g,'<br>')}"),
    ('note admin non echappee', 'app.js', R,
     "${esc(u.note || '')}", "${u.note || ''}"),
    ('nom d espace non echappe dans le bandeau', 'app.js', R,
     "esc(S.currentWorkspace?.name || '?')", "(S.currentWorkspace?.name || '?')"),
    ('R cumule arrondi a une decimale', 'app.js', R,
     "${sign}${st.totalRR.toFixed(2)}<span", "${sign}${st.totalRR.toFixed(1)}<span"),
    ('une zone du bilan perdue', 'app.js', R,
     "${BILAN_ZONES.map(z=>`", "${BILAN_ZONES.slice(1).map(z=>`"),
    ('fonction d un bouton renommee', 'app.js', SRC,
     "function closeConfirm(){", "function closeConfirmer(){"),
    ('id cible renomme', 'app.js', SRC,
     "const list=document.getElementById('j-list');", "const list=document.getElementById('j-liste');"),
    ('confirm() natif reintroduit', 'app.js', SRC,
     "function closeTrade(){", "function closeTrade(){if(!confirm('Quitter ?'))return;"),
    ('commentaire CSS ferme trop tot', 'styles.css', SRC,
     "/* V9.4 — Toolbar flottante */", "/* V9.4 — Toolbar .bd-step*/.bd-link flottante */"),
    ('masquage qui ignore les chaines', 'test/charger-app.js', C,
     "if (c === '\"' || c === \"'\") { chaine(c);", "if (false) { chaine(c);"),
    # v=2 : FND-02 + FND-11
    ('esc() n echappe pas les guillemets', 'app.js', E,
     ".replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');",
     ".replace(/>/g,'&gt;');"),
    ('safeUrl() laisse passer javascript:', 'app.js', E,
     "return /^https?:\\/\\//i.test(s)?esc(s):'#';", "return esc(s);"),
    ('note d analyse brute dans le panneau detail', 'app.js', E,
     'line-height:1.7">${sanitizeNotesHtml(t.analysis_notes)}</div>',
     'line-height:1.7">${t.analysis_notes}</div>'),
    ('note d analyse brute dans le journal', 'app.js', E,
     'line-height:1.7">${sanitizeNotesHtml(t.analysis_notes)}</p>',
     'line-height:1.7">${t.analysis_notes}</p>'),
    ('sanitize qui ne retire pas les balises inconnues', 'app.js', E,
     "if(!ALLOWED_INLINE_TAGS.includes(tag)){", "if(false){"),
    # v=3 : FND-04 (v=5 : Chart.js reference par app.js, plus par index.html)
    ('CDN flottant reintroduit dans index.html', 'index.html', DEP,
     '<script src="vendor/supabase-js-2.118.0/supabase.js"',
     '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"'),
    ('empreinte integrity retiree (index.html)', 'index.html', DEP,
     ' integrity="sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK"', ''),
    ('empreinte integrity retiree (app.js)', 'app.js', DEP,
     "integrity:'" + CHART_SRI + "'", "integrity:''"),
    ('empreinte json obsolete', 'vendor/empreintes.json', DEP,
     CHART_SRI, 'sha384-OBSOLETE0000000000000000000000000000000000000000000000000000'),
    # v=5 : demarrage rapide (UX-12/13/14/15/16)
    ('Chart.js recharge par index.html', 'index.html', DEP,
     '<link rel="stylesheet" href="styles.css?v=5">',
     '<script src="vendor/chartjs-4.4.1/chart.umd.js" integrity="' + CHART_SRI + '" defer></script>\n'
     '<link rel="stylesheet" href="styles.css?v=5">'),
    ('police Google reintroduite', 'index.html', DEP,
     '<link rel="stylesheet" href="styles.css?v=5">',
     '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono" rel="stylesheet"/>\n'
     '<link rel="stylesheet" href="styles.css?v=5">'),
    ('app.js sans defer (execute avant supabase-js)', 'index.html', DEP,
     '<script src="app.js?v=5" defer></script>', '<script src="app.js?v=5"></script>'),
    ('app.js sans cache-bust (ancien fichier en cache)', 'index.html', DEP,
     '<script src="app.js?v=5" defer></script>', '<script src="app.js" defer></script>'),
    ('trades charges apres le profil (vague en plus)', 'app.js', DEM,
     '  const [, , pu] = await Promise.all([loadUsers(), loadAccounts(), lireProfil(), loadTrades()]);',
     '  const [, , pu] = await Promise.all([loadUsers(), loadAccounts(), lireProfil()]);\n  await loadTrades();'),
    ('theme et migration en file', 'app.js', DEM,
     '    applyUserTheme(),\n    migrateLocalStorageToSupabase(),\n    loadAvailableWorkspaces(),\n  ]);',
     '    loadAvailableWorkspaces(),\n  ]);\n  await applyUserTheme();\n  await migrateLocalStorageToSupabase();'),
    ('rapport de la semaine recharge au demarrage', 'app.js', DEM,
     '  buildRptCurrencyBar();\n  // v=5 : le rapport', '  buildRptCurrencyBar();\n  loadCurrencyReport();\n  // v=5 : le rapport'),
    ('ecran d attente jamais retire', 'app.js', DEM,
     "  document.getElementById('app-wrap').classList.add('ready');\n  afficherChargement(false);",
     "  document.getElementById('app-wrap').classList.add('ready');"),
    ('sans session : formulaire jamais rendu', 'app.js', DEM,
     '  }else{\n    afficherChargement(false);\n  }', '  }'),
    ('echec du demarrage : ecran fige', 'app.js', DEM,
     "    finally{if(!document.getElementById('app-wrap').classList.contains('ready'))afficherChargement(false);}", ''),
    ('message aucun espace cache par l ecran d attente', 'app.js', DEM,
     '  if (!S.workspaceId) {\n    afficherChargement(false);', '  if (!S.workspaceId) {'),
    ('Chart.js charge sans empreinte', 'app.js', DEM,
     's.src=b.src;s.integrity=b.integrity;s.async=true;', 's.src=b.src;s.async=true;'),
    ('Chart.js telecharge a chaque demande', 'app.js', DEM,
     'if(!_biblioEnCours[nom])_biblioEnCours[nom]=new Promise', '_biblioEnCours[nom]=new Promise'),
    ('echec de Chart.js definitif', 'app.js', DEM,
     's.onerror=()=>{delete _biblioEnCours[nom];ko(', 's.onerror=()=>{ko('),
    ('graphique dessine sans attendre Chart.js', 'app.js', DEM,
     '  if(!grapheDisponible(redessinerGraphiques))return;\n  // Vue ALL TIME', '  // Vue ALL TIME'),
    ('graphiques redessines a chaque demande', 'app.js', DEM,
     "  const premier=!_relancesGraphes.size;\n  _relancesGraphes.add(relancer);\n  if(premier)chargerBiblio('chart').then(()=>{",
     "  chargerBiblio('chart').then(relancer);\n  if(false)chargerBiblio('chart').then(()=>{"),
    ('graphique Macro sans attendre Chart.js', 'app.js', DEM,
     '  if(!grapheDisponible(()=>renderMacroChart(force)))return;', ''),
    ('captures de la fiche signees une par une', 'app.js', DEM,
     '  const liens=await signerChemins(images.map(i=>i.storage_path));',
     '  const liens={};for(const i of images)Object.assign(liens,await signerChemins([i.storage_path]));'),
    ('vignettes du journal signees par onglet', 'app.js', DEM,
     '  const liens=await signerChemins(grilles.flatMap(g=>g.imgs.map(i=>i.storage_path)));',
     '  const liens={};for(const g of grilles)Object.assign(liens,await signerChemins(g.imgs.map(i=>i.storage_path)));'),
    ('captures du detail signees une par une', 'app.js', DEM,
     '    const liens=await signerChemins(images.map(img=>img.storage_path));',
     '    const liens={};for(const img of images)Object.assign(liens,await signerChemins([img.storage_path]));'),
    ('captures des rapports signees une par une', 'app.js', DEM,
     '    const liens=await signerChemins(aSigner.map(a=>a[2]));',
     '    const liens={};for(const a of aSigner)Object.assign(liens,await signerChemins([a[2]]));'),
    ('ecran d attente pendant une recuperation de mot de passe', 'index.html', DEM,
     '&&!/type=recovery/.test(location.hash)', ''),
    ('cle de session de supabase-js erronee', 'index.html', DEM,
     "'sb-luduuungdwybkntsnafw-auth-token'", "'sb-auth-token'"),
    # v=5 : mobile (UX-01/02)
    ('grille du tableau de bord en style en ligne', 'index.html', MOB,
     '<div id="dash-main">', '<div id="dash-main" style="display:grid;height:calc(100vh - 115px)">'),
    ('panneau de detail plus large que l ecran', 'index.html', MOB,
     'width:500px;max-width:100%;', 'width:500px;'),
    ('en-tete sur une seule ligne', 'styles.css', MOB,
     '  #hdr{flex-wrap:wrap;height:auto;padding:0 10px;}', '  #hdr{padding:0 10px;}'),
    ('tableau de bord non empile sur telephone', 'styles.css', MOB,
     '  #dash-main{display:flex;flex-direction:column;height:auto;overflow:visible;gap:1px;}',
     '  #dash-main{overflow:visible;gap:1px;}'),
    ('Supprimer une capture au survol seulement', 'styles.css', MOB,
     '  .cur-paste-zone-v2.has-img .cur-paste-rm{display:block;', '  .cur-paste-zone-v2.has-img .cur-paste-rm{display:none;'),
    ('cibles tactiles de 26 px', 'styles.css', MOB,
     '  #sec-currency select{min-height:40px;}', '  #sec-currency select{min-height:26px;}'),
    ('zoom iOS au focus des champs', 'styles.css', MOB,
     '  [contenteditable="true"]{font-size:16px;}', '  [contenteditable="true"]{font-size:13px;}'),
]


def main():
    resultats = [muter(f, t, a, n, nom) for nom, f, t, a, n in MUTATIONS]
    tombees = resultats.count(0)
    print(f'\n{tombees}/{len(MUTATIONS)} mutations detectees ; '
          f'{resultats.count(1)} passent encore ; {resultats.count(2)} non applicables')
    sys.exit(0 if tombees == len(MUTATIONS) else 1)


if __name__ == '__main__':
    main()
