# Comptes à créer (tous gratuits, aucune carte bancaire)

| Quand | Compte | Pourquoi |
|---|---|---|
| **Maintenant** (étape 2) | GitHub | dépôt privé + tâches planifiées |
| **Maintenant** (étape 2) | Supabase | base Postgres |
| **Maintenant** (étape 2) | Helius | lecture de la chaîne Solana |
| Fin de l'étape 2 | Vercel | héberger le site |
| Étape 4 | Jeton Claude Code (`claude setup-token`) | fiches rédigées dans GitHub Actions |
| Étape 4 | Bot Telegram (BotFather) | résumé du matin |
| Jamais | DexScreener, GeckoTerminal | API publiques sans clé |

> Règle d'or : ne colle jamais une clé ou un mot de passe dans le chat. Je te dirai à chaque fois dans quel fichier ou quel écran la mettre.

---

## 1. GitHub (dépôt privé)
1. Si tu n'as pas de compte : https://github.com/signup.
2. Rien d'autre pour l'instant. Je crée le dépôt local, puis je te guiderai pour le publier en privé (connexion par le navigateur au premier `git push`).

## 2. Supabase (base de données)
1. https://supabase.com → **Start your project** → connexion avec GitHub (le plus simple).
2. **New project** :
   - Name : `meme-journal`
   - Database password : clique sur **Generate a password** et **garde-le** dans ton gestionnaire de mots de passe.
   - Region : **West EU (Paris)** ou **Central EU (Frankfurt)**.
   - Plan : Free.
3. Attends 1 à 2 minutes que le projet soit prêt.
4. En haut de la page du projet, bouton **Connect** → onglet des chaînes de connexion → section **Transaction pooler** (port **6543**) → copie l'URI.
   Elle ressemble à `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-eu-west-3.pooler.supabase.com:6543/postgres`.
   Remplace `[YOUR-PASSWORD]` par le mot de passe de l'étape 2.
   ⚠️ Prends bien le **pooler**, pas « Direct connection » : la connexion directe est en IPv6 uniquement et GitHub Actions ne la joint pas.
5. Tu n'as rien à créer dans Supabase : j'appliquerai le schéma moi-même avec un script.

## 3. Helius (accès Solana)
1. https://dashboard.helius.dev → inscription (e-mail, GitHub ou Google).
2. L'offre **Free** est activée d'office (1 M crédits/mois, pas de carte).
3. Menu **API Keys** → copie la clé.

## Où mettre ces valeurs
Dans le dossier du projet, crée un fichier `.env.local` (il ne sera jamais publié sur GitHub) :
```
DATABASE_URL=postgresql://postgres.xxxx:MOT_DE_PASSE@aws-0-eu-west-3.pooler.supabase.com:6543/postgres
HELIUS_API_KEY=ta-cle-helius
```
Plus tard, les mêmes valeurs iront dans les **secrets GitHub** et les **variables Vercel** ; je te guiderai écran par écran.

---

## Plus tard (je te guiderai au bon moment)
- **Vercel** : connexion avec GitHub → import du dépôt → variables `DATABASE_URL`, `APP_PASSWORD`, `AUTH_SECRET`.
- **Jeton Claude Code** : dans un terminal, `claude setup-token` → secret GitHub `CLAUDE_CODE_OAUTH_TOKEN`.
- **Telegram** : @BotFather → `/newbot` → jeton ; tu envoies `/start` à ton bot pour que je récupère ton `chat_id`.
