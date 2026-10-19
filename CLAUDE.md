# CLAUDE.md — mémoire des sessions TrackTrading

> Dépôt **public**. Jamais de secret, d'adresse e-mail, ni d'identité de testeur
> ici (ni dans aucun fichier versionné). On compte, on ne cite pas.

## 1. Le projet

Journal de trading : front **statique** (`index.html`, `app.js`, `styles.css`)
publié sur **GitHub Pages**, et un projet **Supabase** (Postgres + RLS, Auth,
Storage, Realtime). Pas de build : `app.js` est un script de navigateur sans
modules. Pas d'Edge Function déployée à ce jour.

- Propriétaire : **Thomas**, développe seul, répond en **français**.
- Thomas n'est **pas à l'aise avec Supabase** : toute écriture DDL (table,
  colonne, règle RLS, fonction, déclencheur, bucket) est **faite par lui**,
  guidée pas à pas (URL de l'éditeur SQL, bloc prêt à coller, résultat attendu,
  que faire en cas d'erreur, retour arrière), puis **vérifiée en lecture**. La
  lecture SQL libre est permise pour auditer.
- **C'est Thomas qui juge le rendu final.** L'assistant vérifie par le code, le
  DOM et les styles calculés (banc d'essai), pas « à l'œil ».
- Mots d'ordre : **cohérente, uniforme, professionnelle, intuitive**.

### Règles qui priment
1. **Vérifier avant d'affirmer** : un défaut se prouve dans le code ou la base
   du jour. Ne jamais recopier un chiffre : le re-mesurer.
2. Toute garde de régression se **valide par mutation** (`scripts/mutations.py`).
3. **Données personnelles** : jamais dans le dépôt ni dans un rapport public.
   Les exemples utilisent `@exemple.fr` et des noms fictifs.
4. **L'assistance ne remplace jamais une saisie** : elle remplit un champ vide
   ou une valeur proposée, et propose le reste.
5. **Ne rien corriger sans l'accord de Thomas.**

## 2. Filet de sécurité (en place depuis le 18/10/2026)

- `npm test` → `node --test "test/**/*.test.js"` (Node ≥ 20 ; **Node 22 refuse
  `node --test test/` — il faut le motif glob**). 62 tests (19/10/2026), 0 dépendance.
- `test/mini-dom.js` : mini-DOM (DOMParser + createElement + innerHTML
  parse/serialize avec entités) pour exercer `sanitizeNotesHtml` dans `node:vm`.
  `getElementById` reste **inerte** (innerHTML = chaîne brute) pour que les
  gardes lisent le rendu tel quel ; seuls les nœuds `createElement`/`DOMParser`
  sont « réels ». Le banc Playwright reste la référence pour le rendu.
- `test/charger-app.js` charge `app.js` dans un contexte `node:vm` avec des
  doublures (document inerte, faux client Supabase, `localStorage`…).
  - **Figer le temps** : `charger({ maintenant: new Date('…') })`.
  - Les `let`/`const` de haut niveau ne sont **pas** sur le contexte : lire avec
    `lire(ctx, 'S_rptMonth')`, écrire avec `injecter(ctx, {…})`.
  - Un tableau venu du contexte échoue en `deepStrictEqual` → `horsContexte(x)`.
  - **Une garde d'écran appelle la fonction de rendu** (pas seulement le source),
    avec un **témoin positif** (un rendu vide ne doit pas passer).
  - `sansCommentaires()` masque commentaires (pas les chaînes) avant une garde
    qui lit le source ; un **canari** vérifie que le masquage n'efface pas de code.
  - Options v=5 : `sansChart` (Chart.js absent, le test simule l'arrivée du
    fichier via `onload` du `<script>` ajouté à `document.head`), `muet` (console
    capturée dans `ctx.__console`), `minuteriesImmediates` (sinon `setTimeout` ne
    s'exécute jamais). Le faux stockage note `db.signatures` (lots
    `createSignedUrls`) et `db.unitaires` (`createSignedUrl`).
  - **Vagues de requêtes** (`test/demarrage.test.js`) : base « à guichet » — chaque
    requête reste en vol jusqu'à ce que le test la serve ; une vague = les requêtes
    en vol ensemble.
- `scripts/muter.py` / `scripts/mutations.py` : réintroduisent chaque défaut et
  vérifient que la garde **tombe** (58/58 au 19/10/2026).
- ESLint `no-undef` : sur une **copie** d'`app.js`, globales du navigateur dans
  `globales.json`, avec un **témoin** (variable inexistante → 1 erreur). 0 erreur
  sur `app.js` au 19/10/2026.
- `scripts/banc/` : banc Playwright (Chromium pré-installé), socle commun
  `commun.js`. supabase-js est **substitué avant `app.js`** (`faux-supabase.js`,
  latence simulée par requête), les `integrity` d'`index.html` sont retirés,
  Chart.js servi vrai. Fuseau **Europe/Paris** et `fr-FR` (navigateur ET
  générateur de données : sinon, entre 0 h et 2 h l'été, ils ne sont pas sur le
  même jour).
  - `npm run banc` : clics de chaque écran, XSS de tous les champs libres
    (marqueur **inerte** `<tt-xss>`, aucun script), débordement iPhone 390 px /
    iPad 820 px. **Échoue** sur erreur de page, fuite XSS **ou débordement**.
  - `npm run mesures` : chargement en « 4G lente » simulée (déconnecté : premier
    affichage, formulaire visible/utilisable ; connecté : 1er écran, tableau de
    bord prêt, requêtes et **vagues**), iPhone/iPad **tactiles** (débordement et
    coupables, cibles < 40 px, bouton visible au survol seul), captures iPhone.
    Variables : `BANC_RACINE` (autre version à comparer, ex. un `git worktree`),
    `BANC_SORTIE`, `BANC_PREFIXE`, `BANC_REPETITIONS` (médiane de N mesures).
  - `BANC_VENDOR` pointe le dossier contenant `package/dist/chart.umd.js` si
    `vendor/` est absent (obtenu par `npm pack chart.js@4.4.1`).

## 3. Schéma (Supabase) — repères

Tables `public` (toutes RLS activée) : `workspaces`, `allowed_emails`, `users`,
`accounts`, `trades`, `trade_images`, `balance_snapshots`, `currency_reports`,
`currency_report_entries`, `currency_report_images`, `user_preferences`.

- **Modèle workspace** : chaque donnée porte `workspace_id`. L'accès passe par
  `is_in_my_workspace(ws)` = `is_super_admin() OR ws = current_workspace_id()`,
  et `current_workspace_id()` lit `allowed_emails` (whitelist) de l'appelant.
  Retirer un e-mail de la whitelist coupe l'accès **à la requête suivante**
  (pas besoin d'attendre l'expiration du jeton) : bon point.
- `is_super_admin()` = rôle `super_admin` dans le JWT **OU**
  `public.users.is_super_admin` de l'appelant.
- Bucket **privé** unique `trade-files` ; chemins `trades/<id>/…` et
  `currency/<id>/…` ; RLS storage par appartenance au workspace du trade/rapport.

## 4. Sources uniques (règle → fonction) — à compléter avec Thomas

| Règle métier | Fonction(s) aujourd'hui | À arbitrer |
|---|---|---|
| Résultat d'un trade | `actual_rr` saisi ; `pnl_amount` saisi | frais/commissions/swap inclus ? |
| Taux de réussite | `calcStats` : gagnants / trades clos (BE au dénominateur) | compter les BE ? |
| R moyen gagné / perdu | `calcStats.avgWinRR/avgLossRR` | — |
| Courbe de solde | `buildCumRRData` (R cumulé, BE = palier plat) | en R ou en $ ? |
| Date du jour | `fmtYMD`/`fmtYM` (heure **locale**) | — |
| Semaine d'un rapport | lundi local (`getMondaysInMonth`) | trade daté instant ou jour de marché ? |

## 5. Pièges connus / faux positifs

- **Échappement** (`test/echappement.test.js`) : tout texte libre dans du HTML
  passe par `esc()` (échappe `& < > " '`) ; un argument JS dans un `onclick`
  par `escJs()` (JSON puis HTML) ; une URL de `href` par `safeUrl()`
  (http/https). **Une note d'analyse de trade est du HTML riche** (éditeur
  contenteditable) → elle s'affiche par `sanitizeNotesHtml()` (liste blanche de
  balises + couleurs), **jamais brute** : journal et panneau de détail alignés
  sur cette fonction (FND-02/11, v=2, 18/10/2026).
- **Fuseau** : la date du jour se lit en **local** (`fmtYMD`), jamais
  `toISOString().slice(0,10)` (décale la veille la nuit l'été). Gardes :
  `test/dates.test.js` (test posé à Paris, 0 h 30 l'été).
- **Advisor sécurité « SECURITY DEFINER exécutable par authenticated »** (9
  fonctions) : **faux positif** pour `is_super_admin`, `current_workspace_id`,
  `is_my_email`, `is_in_my_workspace`, `is_team_member` (ne révèlent que le
  statut de l'appelant) et les `admin_*` (qui vérifient `is_super_admin()` en
  interne). Ne pas re-signaler.
- **Advisor perf « index inutilisés »** (22) et « FK sans index » (1) :
  **normaux à très faible volume** (base quasi vide). Ne rien supprimer.
- **Clé anon + URL Supabase dans `app.js`** : **normal et public par design**.
  Le vrai rempart est la RLS (scopée par workspace : OK).
- Node 22 : `node --test test/` échoue (« Cannot find module .../test ») →
  utiliser le motif glob (déjà dans `package.json`).
- **Démarrage (v=5)** : `index.html` charge supabase-js puis `app.js`, **tous deux
  en `defer`** (un seul des deux en defer = `app.js` s'exécute avant supabase-js).
  Le petit script de tête pose `html.demarrage` (écran « Chargement de ton
  espace… ») si la clé de session de supabase-js existe :
  `sb-<ref du projet>-auth-token` — à changer avec `SB_URL`. `app.js` retire
  toujours la classe (`afficherChargement(false)` : app prête, pas de session,
  échec). Chart.js n'est plus dans `index.html` : `chargerBiblio('chart')`
  (BIBLIOS, même empreinte que `vendor/empreintes.json`) et `grapheDisponible()`
  avant tout `new Chart`. Liens de fichiers : `signerChemins()` (un seul
  `createSignedUrls` par écran) ; `createSignedUrl` unitaire réservé à UN fichier
  qu'on vient de déposer ou de recevoir en temps réel.
- **Rapports** : le rapport de la semaine ne se charge plus au démarrage, mais au
  clic sur l'onglet (la présence « qui édite » ne liste donc que ceux qui ont
  ouvert Rapports).
- **Mobile (v=5)** : la mise en page des grands blocs (`#dash-main`,
  `#dash-top-row`, `#cur-single-view`, `#macro-content`, `#cal-content`) vit dans
  `styles.css`, **jamais en style en ligne** (un style en ligne bat toute media
  query). Seuils : 1000 px (onglets sur une 2e ligne qui défile,
  `--hdr-extra`), 760 px (téléphone : blocs empilés), 600 px (fiche trade plein
  écran) ; `(pointer:coarse)` cibles ≥ 40 px et champs à 16 px (iOS zoome en
  dessous) ; `(hover:none)` « Supprimer » une capture toujours visible. Le
  bureau (> 1000 px, souris) n'a pas bougé : boîtes identiques à 1100/1280/1920 px.
- **Cache (v=5)** : `app.js` et `styles.css` sont appelés avec `?v=N` dans
  `index.html`. **À chaque version qui change l'un d'eux, incrémenter N** : sinon
  un navigateur peut garder l'ancien fichier (GitHub Pages : 10 min de cache)
  avec le nouvel `index.html`.

## 6. Décisions ouvertes (à poser à Thomas, pas à trancher)

- Réécrire l'historique git (force-push) ou passer le dépôt en **privé** : une
  clé d'API tierce (fournisseur de cotations) et une adresse personnelle ont
  vécu dans l'historique ; retirées du code actuel, **toujours dans l'historique**.
- Découpage éventuel d'`app.js` (3 760 lignes) : décision d'architecture.
- Publication minifiée par GitHub Actions + versionnage **automatique** des
  assets (`?v=N` est aujourd'hui manuel, voir §5).
- **CSP** (politique de sécurité du contenu) en balise meta : bibliothèques
  hébergées et police retirée (fait). Il faudra autoriser le script de tête
  d'`index.html` par son empreinte (`'sha256-…'`) et traiter les `onclick=` en ligne.

## 7. Audit du 18/10/2026 + corrections

Rapport complet et priorisé : **remis à Thomas hors dépôt** (il décrit des
défauts non corrigés ; le dépôt étant public, il n'y est pas versionné). Les
constats y sont numérotés FND-01…

**v=2 (en cours)** — correctifs de sécurité P0, sur accord de Thomas :
- **FND-02 + FND-11** (code, fait) : `sanitizeNotesHtml` pour la note d'analyse
  (panneau de détail + journal) ; `esc()` échappe aussi `" '` ; ajout de
  `escJs`/`safeUrl` ; e-mail d'`adminRemove` passé par `escJs`. Banc : 0 fuite XSS.
- **FND-01** (base, critique) — **FERMÉE, joué le 18/10/2026 par Thomas.**
  Déclencheur `protect_users_sensitive_trg` (SECURITY **INVOKER**) `BEFORE UPDATE`
  sur `public.users` : un membre (`current_user = 'authenticated'`, non
  super-admin) ne peut plus modifier `is_super_admin`, `workspace_id`, `email`,
  `auth_user_id`, `id`. Script + STATUT : `supabase/sql/2026-10-18_fnd01_protect_users.sql`.
  Vérifié en lecture sur la prod (transaction annulée) : tentative d'élévation
  **refusée `42501`**, modif bénigne (color) passe. Détail dans le rapport privé.
  ⚠️ Un déclencheur sur `public.users` en **SECURITY DEFINER** ne marcherait pas
  (`current_user` = propriétaire → garde jamais active) : rester en INVOKER.

**v=3 (en cours)** — secrets & dépendances :
- **FND-04** (code, fait) : supabase-js (2.118.0) et Chart.js (4.4.1) **hébergés
  dans `vendor/`** avec empreinte **SRI**, fin du CDN flottant. `vendor/empreintes.json`
  + garde `test/dependances.test.js` (refuse tout CDN / version flottante, vérifie
  empreintes ↔ fichiers ↔ `index.html`). `@2` résolvait déjà vers 2.118.0 →
  aucun changement de comportement. (Police Google : retirée en v=5, FND-12.)
- **FND-03** (clé tierce dans l'historique git public) : à **renouveler chez le
  fournisseur** par Thomas (action hors dépôt). La clé n'est plus utilisée par le
  code (section Macro en données figées), mais peut rester valide chez le fournisseur.

**v=5 (19/10/2026, en attente de publication)** — mobile + démarrage, sur accord
de Thomas (plan du rapport UX v1, remis hors dépôt comme le v2) :
- **Démarrage** : requêtes en vagues parallèles (`postLogin` : whitelist + thème +
  migration ensemble ; `initApp` : traders + comptes + profil + trades ensemble),
  écran « Chargement de ton espace… », Chart.js à la demande (FND-13), police
  Google retirée (FND-12), liens signés groupés (FND-16), rapport de la semaine
  chargé à l'ouverture de Rapports, `?v=5` (FND-15).
- **Mobile** (FND-09) : en-tête sur 2 lignes sous 1000 px, blocs empilés sous
  760 px, fiche trade plein écran sous 600 px, panneau de détail ≤ largeur
  d'écran, cibles tactiles ≥ 40 px, champs à 16 px, « Supprimer » une capture
  visible au doigt, bouton plein écran masqué sur téléphone.
- **Mesuré** (banc, 4G lente simulée, médiane de 5) : formulaire visible
  772 → 464 ms ; tableau de bord prêt 2 055 → 1 352 ms ; 11 requêtes en 8 vagues
  → 9 en 4 ; débordement 9/9 → 0/9 vues (iPhone et iPad) ; cibles < 40 px
  186/264 → 0/256. Bureau : boîtes identiques à 1100/1280/1440/1920 px.
- Restent (rapport UX v2) : FND-10/UX-05 indicateurs, UX-03 macro datée,
  sélection de plusieurs mois au doigt, message « aucun workspace », etc.

⚠️ **Déploiement** : rien côté Supabase pour la v=5. Assets versionnés `?v=5`
(garde dans `test/dependances.test.js`) : **incrémenter N** à la prochaine version
qui modifie `app.js` ou `styles.css`.
