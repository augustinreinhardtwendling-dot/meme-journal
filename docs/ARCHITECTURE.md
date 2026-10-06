# Meme Journal — Architecture (étape 1)

> Proposition vérifiée le 6 octobre 2026 contre les API réelles (appels en direct, pas seulement la doc).
> Schéma SQL : [db/migrations/0001_init.sql](../db/migrations/0001_init.sql) (testé dans un Postgres en mémoire).

---

## 0. Mesures réelles (journal du 6 octobre 2026, étape 2)

| | Valeur mesurée |
|---|---|
| Tx réussies du compte de migration | 1 740 (dont ~450 appels « à vide » sur des curves déjà migrées) |
| Vraies migrations | **1 286**, dont **255 migrations fantômes** (curve quasi vide) → **1 031 bondings normaux** |
| Quotes | SOL très majoritaire ; quelques coins en PUMP, ZEC, SPYx… |
| Mcap de migration standard | 325,8 SOL (~39 400 $ avec le SOL à 121 $) |
| Survivants du tri A | **42 / 1 031 (4 %)** |
| Retenus après le tri B | 4 (tous Runners) |
| Crédits Helius | collecte ≈ 2 600 ; tri B ≈ 50 à 110 par coin (short-circuit) |
| Durée locale | collecte ≈ 8 min ; tri B complet (--full) ≈ 25 min, limité par GeckoTerminal |

Découvertes qui ont changé le code :
- `getTransactionsForAddress` est disponible sur l'offre gratuite (10 crédits / 100 tx, filtres par date et par token) : collecte ×10 moins chère.
- Beaucoup de coins sont créés **et** bondés dans la même transaction (le dev achète toute la curve) : 79,31 % de la supply au dev, puis volume gonflé par 10 à 25 wallets (≈ 6 800 tx/jour). Le bonding artificiel et le wash trading les éliminent.
- GeckoTerminal refuse des requêtes (429) avant 30/min : 1 requête toutes les 3 s et pause de 20 s après un refus.
- Le wallet « creator » inscrit dans la curve peut différer du signataire de la création : les deux sont traités comme le dev.

---

## 1. Vue d'ensemble

```
                       ┌──────────────── GitHub Actions (1 passage/jour, ~04:17 UTC) ────────────────┐
                       │                                                                              │
 Helius RPC ──────────▶│ 1. collecte     migrations pump.fun de la fenêtre [H-48, H-24]               │
 (1M crédits/mois)     │ 2. tri A        DexScreener : mcap ≥ mcap migration, volume 24 h > 50 k$     │
 DexScreener ─────────▶│ 3. tri B        holders, bundle, insiders, snipers, dev sell, top 10, wash…   │
 GeckoTerminal ───────▶│ 4. score        0–100 + tag Runner / CTO                                      │──▶ Supabase
 IPFS (métadonnées) ──▶│ 5. export       work/input.json                                               │    (Postgres)
                       │ 6. Claude Code  fiches + classement des metas  → work/fiches.json             │       ▲
                       │ 7. ingestion    validation zod → base (échec = journal publié sans fiches)    │       │
                       │ 8. stats        metas en hausse / baisse / saturées                           │       │
                       │ 9. Claude Code  « À surveiller » (+ récap le lundi) → work/watchlist.json     │       │
                       │10. publication  statut « publié » + message Telegram                          │       │
                       └──────────────────────────────────────────────────────────────────────────────┘       │
                                                                                                              │
  Toi (mobile) ──▶ Vercel (Next.js, mot de passe) ────────────────────── lecture / réglages ─────────────────┘
  Telegram ◀── bot (résumé + lien)
```

- **Aucun appel à l'API Anthropic.** Claude Code tourne en mode non interactif (`claude -p`) dans le workflow, authentifié par `CLAUDE_CODE_OAUTH_TOKEN` (abonnement Pro).
- **Le site ne fait aucun calcul lourd** : il lit la base. Tout le travail se fait dans GitHub Actions.
- **Un seul dépôt, un seul `package.json`** : l'app Next.js et les scripts du pipeline partagent le code de détection (`lib/`).

---

## 2. Ce que j'ai vérifié en direct, et ce que ça change

| Constat (6 oct. 2026) | Conséquence |
|---|---|
| **≈ 1 400 à 1 600 migrations pump.fun par jour.** Le compte de migration `39azUY…jUJjg` a eu 1 592 tx réussies dans la fenêtre H-48→H-24 ; sur un échantillon de 39, 35 étaient de vraies migrations (`MigrateV2` / `Migrate`) vers PumpSwap. | Beaucoup plus que prévu. Le tri A (gratuit) doit éliminer la masse avant tout appel on-chain coûteux. Le classement des metas par Claude porte sur ~1 400 coins par jour : je dédoublonne les copies (même nom/ticker normalisé) avant de les envoyer. |
| Solana a désormais des **transactions « version 1 »** : `getTransaction` échoue sans `maxSupportedTransactionVersion: 1`. | Géré dans le client RPC. |
| Les nouveaux coins pump.fun sont en **Token-2022** (programme `TokenzQd…`), pas tous. | Lecture des métadonnées dans les deux formats (extension Token-2022 et Metaplex). |
| Dans une tx `MigrateV2` : compte n°2 = mint, n°4 = bonding curve, n°10 = pool PumpSwap. Recoupé avec GeckoTerminal (`migrated_destination_pool_address`). | Collecte fiable avec 1 crédit Helius par coin. |
| **GeckoTerminal gratuit** (`/tokens/{mint}/info`) renvoie : nombre de holders, part du top 10, wallet du dev, date de complétion, pool de migration, description, réseaux. `/pools/{pool}` renvoie acheteurs et vendeurs uniques sur 24 h ; `/trades` les 300 derniers trades avec le wallet ; `/ohlcv` jusqu'à 1 000 bougies. Limite : 30 requêtes/min. | Le seuil de 300 holders, une bonne partie du wash trading et l'ATH ne coûtent **aucun crédit Helius**. Limite à surveiller : sur un coin migré à l'instant, le nombre de holders affiché était en retard (16) ; à 24 h, à recouper pendant le backfill. |
| **DexScreener** (sans clé) : `/tokens/v1/solana/{jusqu'à 30 mints}` (mcap, volume, liquidité, réseaux). Bonus découvert : `/orders/v1/solana/{mint}` indique si un **CTO** a été validé, et `/metas/trending/v1` donne les metas tendance du moment. | Tri A pour ~1 400 coins en ~50 appels. Signal CTO gratuit. |
| L'API non officielle de pump.fun (`frontend-api-v3`) répond 404. | On ne dépend pas d'elle : tout vient de la chaîne + DexScreener + GeckoTerminal. |
| Helius gratuit : 1 M crédits/mois, 10 req/s. `getTransaction`, `getSignaturesForAddress`, `getAccountInfo`, `getTokenLargestAccounts` = **1 crédit** ; `getProgramAccounts` = 10 ; DAS = 10 ; API enrichie = 100. `getTransactionsForAddress` (10 crédits / 100 tx) : disponibilité sur l'offre gratuite non documentée. | RPC standard uniquement, comme demandé. Je testerai `getTransactionsForAddress` avec ta clé : s'il est disponible, l'analyse des premiers trades coûte ~10× moins cher. |
| Claude Code : l'option `--bare` (recommandée en CI) **ne lit pas** le jeton d'abonnement. | On lance `claude -p` sans `--bare`, avec des permissions verrouillées (voir §6). |
| WebSearch fonctionne sur l'API Anthropic directe (c'est le cas avec un abonnement), plafond de 200 recherches par session. | Recherche web a priori disponible ; confirmé au premier vrai passage. Plan B gratuit prévu (§6). |
| Vercel Hobby n'inclut pas la protection par mot de passe (option payante). | Connexion codée dans l'app (cookie signé, mot de passe en variable d'environnement). |

---

## 3. Le passage quotidien, étape par étape

**Fenêtre ancrée.** Les crons GitHub partent souvent avec 5 à 30 min de retard. Pour éviter trous et doublons entre deux journaux, la fenêtre n'est pas « maintenant − 48 h » mais ancrée sur une heure fixe : le journal du jour J couvre les bondings entre **J-2 04:00 UTC et J-1 04:00 UTC** (bornes réglables). Chaque coin a donc au moins 24 h de recul.

### 1. Collecte (tous les coins bondés)
1. `getSignaturesForAddress(39azUY…)` paginé jusqu'au début de la fenêtre (~5 crédits).
2. `getTransaction` sur chaque signature réussie (~1 600 crédits) → mint, bonding curve, pool, heure de migration, réserves de la pool → mcap de migration en SOL. Le prix du SOL à l'heure de la migration vient d'une bougie GeckoTerminal SOL/USDC (1 appel par jour).
3. Métadonnées : `getMultipleAccounts` par lots de 100 (~30 crédits) → nom, ticker, URI ; puis le JSON IPFS → description, image, X, Telegram, site.
4. Date de création et durée de bonding : `getSignaturesForAddress(bonding curve)` paginé jusqu'à la 1re tx (~3 crédits par coin en moyenne, ~4 500 par jour). Donne aussi le nombre de tx avant bonding. Wallet du dev = signataire de la tx de création.

### 2. Tri A (gratuit)
DexScreener par lots de 30 : mcap actuelle ≥ mcap de migration **et** volume 24 h > 50 000 $. Sinon : **« mort après bonding »**.

### 3. Tri B (survivants), du moins cher au plus cher
L'ordre permet d'arrêter l'analyse dès qu'un critère exclut le coin (`short_circuit`, désactivé pendant le backfill pour mesurer tous les critères et calibrer).

| # | Critère | Méthode | Coût Helius |
|---|---|---|---|
| 1 | **Holders ≥ 300** | GeckoTerminal `tokens/{mint}/info` | 0 |
| 2 | **Wash trading** | GeckoTerminal : tx / wallets uniques sur 24 h ; dans les 300 derniers trades, part du volume faite par des wallets qui achètent ET revendent en boucle | 0 |
| 3 | **Concentration** | `getTokenLargestAccounts` (top 20) + `getMultipleAccounts` pour les propriétaires ; on exclut la pool PumpSwap, le burn et les adresses hors courbe (PDA = comptes de programme). Top 10 / supply en circulation | ~3 |
| 4 | **Bonding artificiel** | Seulement si bonding < 10 min. Si moins de 150 tx avant bonding → forcément < 150 acheteurs, exclusion sans autre appel ; sinon on compte les signataires uniques (plafonné) | 0 à ~1 500 |
| 5 | **Bundle** | Toutes les tx du bloc de création (slot de la 1re signature) : acheteurs ≠ dev, tokens reçus calculés par différence des soldes (pré/post), robuste aux bundles Jito et aux agrégateurs | ~5 à 20 |
| 6 | **Snipers** | Même méthode sur les achats des `sniper_window_seconds` (5 s ≈ 12 slots) après la création | ~20 à 80 |
| 7 | **Insiders** | Dev + wallets liés parmi les 30 plus gros acheteurs avant bonding. Lié = financé en SOL par le dev, ou par la même source que le dev / qu'un autre acheteur, dans les 72 h avant le lancement. Les CEX et bridges (table `known_wallets`) ne comptent pas comme source commune. Résultats mis en cache dans `wallet_funding` : les bundlers récurrents deviennent gratuits à repérer | ~60 à 150 |
| 8 | **Dev sell** | Tx des comptes de token du dev et des wallets liés → part vendue. Chute = prix juste avant la vente vs plus bas dans les 60 min suivantes (bougies GeckoTerminal après migration ; réserves de la curve avant). **CTO** : chute > 40 %, puis mcap actuelle ≥ mcap de migration et CTO validé sur DexScreener (`/orders`) ou forte reprise → conservé avec le tag CTO | ~10 à 40 |
| 9 | **Dev récidiviste** | Lancements pump.fun du wallet du dev sur 30 jours et part de ceux qui n'ont pas bondé ou sont morts. Méthode à trancher avec ta clé au backfill : `getProgramAccounts` filtré sur le champ `creator` des bonding curves (10 crédits) si Helius l'accepte sur le programme pump.fun, sinon historique du wallet | 10 à ~50 |

Chaque exclusion enregistre `{code, libellé, valeur mesurée, seuil, détail}` (par ex. *bundle : 14,2 % > 10 % — 7 wallets dans le slot 312 456 789*).

### 4. Score (0–100) et tags
- **Distribution (50 pts)** : top 10, bundle, insiders, snipers, wash. Chaque sous-score vaut 1 quand la mesure est nulle et 0 quand elle atteint le seuil d'exclusion, avec un bonus si le nombre de holders est élevé (échelle log).
- **Performance (50 pts)** : mcap actuelle / mcap migration (échelle log, 1× → 0, 32× → max), multiple d'ATH, volume / mcap sain, liquidité.
- **Runner** : ATH ≥ 5 × mcap de migration. **CTO** : voir dev sell.
- Pondérations ajustables après le backfill.

### 5–10. Claude Code, stats, publication → §6 et §7.

---

## 4. Budget et quotas (estimation, à confirmer au backfill)

| Poste | Par jour | Par mois | Limite gratuite |
|---|---|---|---|
| Helius : collecte (migrations + métadonnées + dates de création) | ~6 200 crédits | ~190 k | 1 M crédits |
| Helius : analyse on-chain (~40 à 80 coins après filtres gratuits) | ~5 000 à 12 000 | ~150 à 360 k | |
| **Total Helius** | **≈ 11 à 18 k** | **≈ 330 à 550 k** | **1 M** → marge confortable |
| Backfill 7 jours (une fois) | | ≈ 100 à 130 k | |
| GitHub Actions (dépôt privé) | ~35 à 50 min | ~1 100 à 1 500 min | 2 000 min |
| GeckoTerminal | ~300 appels (≈ 10 min à cause des 30/min) | | 30 req/min |
| Supabase | ~2 000 lignes/jour, quelques Mo/mois | | 500 Mo |
| Vercel | quelques pages vues | | Hobby |

**Garde-fous :**
- Plafond de crédits Helius par jour (`helius_daily_credit_cap`, 28 000 par défaut). S'il est atteint, les coins restants sont marqués « non analysé (budget) », jamais classés à tort.
- Les crédits sont comptés appel par appel et affichés dans Réglages, ainsi que les minutes GitHub et la durée des passages Claude.
- Supabase met en pause un projet gratuit après 7 jours d'inactivité : le passage quotidien suffit à le garder actif.

**Quota Claude Pro.** C'est la vraie limite. Il est partagé avec ton usage de claude.ai et Claude Code, avec une fenêtre de 5 h et un plafond hebdomadaire. Un passage = 10 fiches avec recherche web + classement d'environ 1 400 coins (dédoublonnés) + « À surveiller ». Mesures prises : modèle Sonnet par défaut, 4 recherches maximum par fiche, liste de coins compacte, passage la nuit. On mesure la consommation des premiers jours et on ajuste le nombre de fiches.

---

## 5. Sources de données

| Besoin | Source | Clé | Notes |
|---|---|---|---|
| Migrations, tx de lancement, holders top 20, financements | Helius RPC standard | oui (gratuite) | `maxSupportedTransactionVersion: 1` |
| Mcap, volume, liquidité, réseaux, CTO | DexScreener | non | lots de 30 mints |
| Holders, acheteurs uniques, trades, ATH (OHLCV), prix du SOL | GeckoTerminal | non | 30 req/min, file d'attente intégrée |
| Description, image, liens | JSON de métadonnées (IPFS) | non | plusieurs passerelles en secours |
| Metas tendance (contexte pour Claude) | DexScreener `/metas/trending/v1` | non | |
| Actualité, tweets, événements | WebSearch / WebFetch de Claude Code | abonnement | X ne se lit pas sans compte : Claude passe par les articles et agrégateurs qui citent les tweets |

---

## 6. Claude Code dans GitHub Actions

**Installation** : `npm i -g @anthropic-ai/claude-code` dans le job, variable `CLAUDE_CODE_OAUTH_TOKEN` (secret GitHub, généré une fois par `claude setup-token` sur ton PC, valable environ un an).

**Appel 1 : fiches + metas**
```
claude -p "$(cat pipeline/claude/prompt-fiches.md)" \
  --model sonnet --max-turns 80 --output-format json \
  --permission-mode dontAsk \
  --allowedTools "WebSearch,WebFetch,Read,Write"
```
- Entrée `work/input.json` : top N coins retenus (métriques, liens, chronologie) + tous les coins bondés de la fenêtre (nom, ticker, description, dédoublonnés) + liste actuelle des metas.
- Sortie imposée `work/fiches.json` : un schéma JSON (zod) fourni dans le prompt, avec des exemples.
- `dontAsk` refuse tout ce qui n'est pas listé : pas de Bash, pas d'accès réseau hors recherche. Une règle `deny` interdit l'écriture hors de `work/`.
- Le résultat JSON de la CLI donne la durée et le nombre de tours, stockés dans `runs`.

**Validation (script)** : schéma zod strict.
- Mint inconnu, meta inexistante non déclarée dans `new_metas`, source sans URL ou affirmation sans catégorie fait/hypothèse → la fiche est rejetée, et elle seule.
- Les fiches valides sont enregistrées. Les autres repassent en `pending` et sont retentées au passage suivant (3 tentatives maximum), avant les nouvelles.

**Appel 2 : « À surveiller »** (après le calcul des stats) : entrée = stats des metas sur 3 et 7 jours, fiches récentes, metas tendance DexScreener. Claude cherche l'actualité et les événements à venir, puis écrit `work/watchlist.json`. Le lundi, il ajoute le récap hebdomadaire.

**Échec ou quota atteint** : les étapes Claude sont en `continue-on-error` avec un `timeout-minutes`. La publication et Telegram s'exécutent toujours (`if: always()`) : le journal sort sans fiches, avec la mention « fiches en attente ».

**Règles éditoriales imposées dans le prompt et vérifiées par le schéma** : champs `faits[]` et `hypotheses[]` séparés ; chaque fait porte au moins une source (URL) ; « catalyseur non identifié » obligatoire quand rien n'est trouvé ; vocabulaire de conseil (achète, vends, entrée, cible…) détecté et refusé à la validation.

**Plan B si WebSearch n'est pas disponible** dans ce mode : Claude garde WebFetch sur des sources gratuites et sans clé, comme Google News RSS (`news.google.com/rss/search?q=…`), Reddit (`.json`) et les pages DexScreener ; la qualité des catalyseurs liés à X baisse. Je te préviendrai au premier passage réel.

---

## 7. Interface (Next.js, mobile d'abord)

| Page | Contenu |
|---|---|
| `/` Journal du jour | Résumé 5 lignes (prix du SOL, bondés, retenus, meta dominante, statut des fiches) ; une carte par coin retenu : image, nom, ticker, mcap migration → ATH → actuelle, holders, score, tags, fiche dépliable, verdict « peut remarcher ? » + confiance, liens pump.fun / DexScreener / Solscan / X ; bloc repliable **Exclus** : compteurs par raison, détail consultable ; bloc **À surveiller** |
| `/journal/[date]` | Même vue pour une date passée |
| `/tendances` | Metas sur 7 et 30 jours (courbes), taux de réussite par meta, metas saturées |
| `/archives` | Calendrier + recherche par ticker, meta ou date |
| `/reglages` | Seuils, fenêtre, nombre maximum de fiches, budget ; consommation du mois (crédits Helius, minutes et durée des passages Claude) |
| `/connexion` | Mot de passe |

- **Accès** : un middleware (`proxy.ts` sous Next.js 16) vérifie un cookie signé (HMAC, `AUTH_SECRET`) ; le mot de passe est comparé en temps constant à `APP_PASSWORD`. Délai après plusieurs échecs. En-tête `noindex`.
- **Images** : balises `<img>` simples (pas l'optimiseur d'images de Vercel, limité sur Hobby).
- **Base** : `postgres` (postgres.js) via le pooler Supabase en mode transaction (port 6543, `prepare: false`). Le serveur Vercel est le seul à parler à la base.
- **Graphiques** : Recharts. Tailwind v4.

---

## 8. Secrets (jamais dans le code)

| Secret | GitHub Actions | Vercel | `.env.local` (ton PC, ignoré par git) |
|---|---|---|---|
| `DATABASE_URL` (URI du pooler Supabase) | ✓ | ✓ | ✓ |
| `HELIUS_API_KEY` | ✓ | | ✓ |
| `CLAUDE_CODE_OAUTH_TOKEN` | ✓ | | |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | ✓ | | |
| `APP_URL` (lien envoyé par Telegram) | ✓ | | |
| `APP_PASSWORD`, `AUTH_SECRET` | | ✓ | |

Point d'attention : la connexion directe Supabase est en IPv6 uniquement sur l'offre gratuite, et les runners GitHub ne parlent pas IPv6. On utilise **toujours l'URI du pooler** (Supavisor), compatible IPv4.

---

## 9. Arborescence du dépôt

```
meme-journal/
├─ app/                         Next.js (App Router) : pages listées au §7
├─ components/                  cartes coin, bloc exclus, graphiques…
├─ lib/
│  ├─ db.ts  config.ts  types.ts
│  ├─ detection/                fonctions pures, testées : bundle, snipers, insiders,
│  │                            devsell, concentration, fastbond, wash, serialdev
│  └─ scoring.ts
├─ pipeline/
│  ├─ sources/                  helius.ts (compteur de crédits), dexscreener.ts,
│  │                            geckoterminal.ts (file 30/min), metadata.ts
│  ├─ collect.ts  stage-a.ts  stage-b.ts  publish.ts  stats.ts  telegram.ts
│  ├─ backfill.ts  rejudge.ts   (recalcule les verdicts depuis les métriques stockées)
│  └─ claude/                   export.ts, ingest.ts, schema.ts (zod), prompt-*.md
├─ db/migrations/               SQL versionné + petit script d'application
├─ tests/                       vitest : détection sur des scénarios fabriqués + vraies tx enregistrées
├─ .github/workflows/
│  ├─ daily.yml                 cron quotidien
│  └─ backfill.yml              lancement manuel (dates en paramètre)
└─ docs/
```

---

## 10. Risques et points à calibrer au backfill

1. **Volume** : environ 1 400 bondés par jour. Les seuils du tri A décident de la facture Helius ; le backfill mesurera combien passent chaque filtre.
2. **Retard des holders sur GeckoTerminal** : à recouper sur un échantillon avec un comptage on-chain.
3. **Dev récidiviste** : méthode à trancher avec ta clé (voir tableau du §3).
4. **Faux positifs insiders** : financement commun par un CEX ou un service d'échange instantané → la liste `known_wallets` s'enrichit pendant le calibrage.
5. **Évolutions de pump.fun** (instructions `Migrate` → `MigrateV2`, Token-2022, nouveaux modes de lancement) : le parseur repose sur les variations de soldes plutôt que sur l'ordre des comptes quand c'est possible, et un test de non-régression rejoue des tx réelles enregistrées.
6. **Quota Claude Pro** : à mesurer les premiers jours (§4).
