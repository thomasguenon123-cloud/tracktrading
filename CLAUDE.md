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
  `node --test test/` — il faut le motif glob**). 34 tests, 0 dépendance.
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
- `scripts/muter.py` / `scripts/mutations.py` : réintroduisent chaque défaut et
  vérifient que la garde **tombe** (24/24 au 18/10/2026).
- ESLint `no-undef` : sur une **copie** d'`app.js`, globales du navigateur dans
  `globales.json`, avec un **témoin** (variable inexistante → 1 erreur). 0 erreur
  sur `app.js` au 18/10/2026.
- `scripts/banc/` : banc Playwright (Chromium pré-installé). supabase-js est
  **substitué avant `app.js`** (`faux-supabase.js`), les `integrity` sont retirés,
  Chart.js servi vrai. Balayages : clics de chaque écran, XSS de tous les champs
  libres (marqueur **inerte** `<tt-xss>`, aucun script), débordement iPhone
  390 px / iPad 820 px. `BANC_VENDOR` pointe le dossier contenant
  `package/dist/chart.umd.js` (obtenu par `npm pack chart.js@4.4.1`).

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

## 6. Décisions ouvertes (à poser à Thomas, pas à trancher)

- Réécrire l'historique git (force-push) ou passer le dépôt en **privé** : une
  clé d'API tierce (fournisseur de cotations) et une adresse personnelle ont
  vécu dans l'historique ; retirées du code actuel, **toujours dans l'historique**.
- Découpage éventuel d'`app.js` (3 760 lignes) : décision d'architecture.
- Publication minifiée par GitHub Actions + versionnage des assets `?v=N`.
- Héberger les bibliothèques dans `vendor/` (fin des CDN) + CSP.

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

⚠️ **Déploiement** : les assets ne sont pas versionnés (`?v=N`, FND-15) — après
une mise en ligne, prévoir un cache-bust pour que le nouvel `app.js` soit chargé.
