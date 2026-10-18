# Tests & banc d'essai — TrackTrading

Aucune dépendance npm. Node ≥ 20 (testé sur Node 22).

## Tests unitaires

```sh
npm test            # node --test "test/**/*.test.js"
```

> ⚠️ Sur Node 22, `node --test test/` échoue (« Cannot find module .../test »).
> Toujours passer par `npm test` (motif glob) ou `node --test "test/**/*.test.js"`.

- `charger-app.js` — charge `app.js` dans un contexte `node:vm` avec des
  doublures minimales (document inerte, faux client Supabase, `localStorage`,
  Chart.js factice). Expose : `charger({maintenant, db, source})`,
  `injecter(ctx, {…})`, `lire(ctx, 'expr')`, `horsContexte(x)`, `faireDb(…)`,
  `sansCommentaires(src)`.
- `charger.test.js` — l'app se charge ; **canari** du masquage de commentaires.
- `dates.test.js` — fuseau : test posé à **Paris, 0 h 30 en été**.
- `stats.test.js` — règles du tableau de bord (taux, R cumulé, sélection mois).
- `rendu.test.js` — **appelle** chaque fonction de rendu (journal, stats, détail
  trade, rapports, bilan, macro, calendrier, admin, bandeau) + échappement XSS,
  avec témoin positif.
- `source.test.js` — gardes statiques : boutons morts, `getElementById`
  orphelins, `confirm/alert/prompt` natifs, dates UTC, CSS (commentaires fermés).

Pièges (voir `CLAUDE.md §2`) : figer le temps ; les `let`/`const` d'`app.js` ne
sont pas sur le contexte (passer par `lire`/`injecter`) ; un tableau du contexte
échoue en `deepStrictEqual` (→ `horsContexte`).

## Valider les gardes par mutation

```sh
python3 scripts/mutations.py          # rejoue toutes les mutations (doivent TOMBER)
python3 scripts/muter.py app.js test/dates.test.js "<ancien>" "<nouveau>" "nom"
```

« PASSE ENCORE » = garde inefficace, à renforcer. Ajouter une ligne dans
`scripts/mutations.py` à chaque nouvelle garde.

## ESLint no-undef (hors dépôt)

Sur une **copie** d'`app.js`, avec les globales du navigateur dans
`globales.json` (extraites de Chromium) et un **témoin** (variable inexistante
→ 1 erreur attendue). Voir `CLAUDE.md §2`.

## Banc d'essai navigateur (Playwright + Chromium)

```sh
# 1) récupérer Chart.js 4.4.1 (empreinte réelle) dans un dossier vendor :
cd <dossier-vendor> && npm pack chart.js@4.4.1 && tar -xzf chart.js-4.4.1.tgz
# 2) lancer le banc :
BANC_VENDOR=<dossier-vendor> PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run banc
```

Le banc **substitue supabase-js avant `app.js`** (`scripts/banc/faux-supabase.js`,
données fictives de `scripts/banc/donnees.js`, écritures relevées dans
`window.__appels`), **retire les `integrity`** d'`index.html` et sert Chart.js
vrai. Il rejoue : clics de chaque écran (erreurs console / `pageerror`), XSS de
tous les champs de texte libre (**marqueur inerte `<tt-xss>`, aucun script**),
débordement iPhone 390 px / iPad 820 px (filet `overflow-x` neutralisé pour voir
ce qui dépasse vraiment).

Sortie : JSON + résumé. Code de sortie ≠ 0 si un `pageerror` ou une fuite XSS est
trouvé. **Jamais de vraies données de Thomas dans le banc.**
