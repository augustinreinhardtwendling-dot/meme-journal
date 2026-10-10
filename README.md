# Meme Journal

Journal quotidien privé des memecoins pump.fun qui ont vraiment fonctionné : collecte des coins bondés,
tri des coins truqués (bundles, insiders, snipers, dev sell, wash trading…), score, et fiches rédigées
par Claude Code. Architecture détaillée : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Site en local (http://localhost:3000) |
| `npm run check:env` | Vérifie `.env.local` et les connexions (sans afficher les secrets) |
| `npm run db:migrate` | Applique les fichiers `db/migrations/*.sql` manquants |
| `npm run pipeline` | Passage du jour (collecte → tri A → tri B → score) |
| `npm run pipeline -- --date 2026-10-06` | Journal d'une date précise |
| `npm run pipeline -- --date … --skip-collect` | Relance l'analyse sans refaire la collecte |
| `npm run pipeline -- --date … --full` | Mesure tous les critères (calibrage) |
| `npx tsx --env-file=.env.local scripts/inspect.ts 2026-10-06` | Détail des coins analysés à l'étape B |
| `npm test` | Tests des fonctions de détection |

## Variables d'environnement

Voir [.env.example](.env.example) et [docs/COMPTES.md](docs/COMPTES.md). Jamais de secret dans le code.

## Organisation

- `pipeline/` : tâches du passage quotidien (exécutées par GitHub Actions)
- `lib/detection/` : fonctions de détection pures et testées
- `lib/onchain/parse.ts` : lecture des transactions Solana par variations de soldes
- `app/`, `components/` : site Next.js
- `db/migrations/` : schéma SQL versionné

## Passages Claude Code (étape 4)

Le workflow quotidien enchaîne trois passages `claude -p` (abonnement Pro, jeton `CLAUDE_CODE_OAUTH_TOKEN`),
chacun avec sa consigne dans `pipeline/claude/` et des permissions limitées à l'écriture dans `work/` :

1. **classement** de tous les coins bondés par meta (`classement-input.json` → `classement-output.json`) ;
2. **fiches** des meilleurs retenus avec recherche web (`fiches-input.json` → `fiches-output.json`) ;
3. **« À surveiller »** (+ récap hebdo le lundi) à partir des statistiques des metas.

Chaque sortie est validée (`lib/claude-schema.ts` : format, sources obligatoires, aucun conseil d'achat/vente)
puis enregistrée par `npm run claude:ingest`. Une étape en échec n'empêche pas la publication ; les fiches
manquantes sont retentées au passage suivant (3 essais).

| Commande | Rôle |
|---|---|
| `npm run claude:export -- --step classement\|fiches\|watchlist` | Prépare les fichiers lus par Claude Code |
| `npm run claude:ingest -- --step …` | Valide et enregistre la sortie |
| `npm run stats` | Statistiques des metas (taux de réussite, tendances, saturation) |
| `npm run publish -- --dry` | Aperçu du message Telegram |
