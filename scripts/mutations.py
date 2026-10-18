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
]


def main():
    resultats = [muter(f, t, a, n, nom) for nom, f, t, a, n in MUTATIONS]
    tombees = resultats.count(0)
    print(f'\n{tombees}/{len(MUTATIONS)} mutations detectees ; '
          f'{resultats.count(1)} passent encore ; {resultats.count(2)} non applicables')
    sys.exit(0 if tombees == len(MUTATIONS) else 1)


if __name__ == '__main__':
    main()
