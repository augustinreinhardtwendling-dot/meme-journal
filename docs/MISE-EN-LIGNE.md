# Mise en ligne (GitHub + Vercel)

## 1. Dépôt GitHub privé
1. https://github.com/new
2. Repository name : `meme-journal` · **Private** · ne coche rien d'autre (pas de README, pas de .gitignore).
3. **Create repository**, puis donne-moi l'URL du dépôt (`https://github.com/<toi>/meme-journal`).
4. J'envoie le code. Au premier envoi, Windows ouvre une fenêtre de connexion GitHub : choisis
   « Sign in with your browser » et valide.

## 2. Secrets du passage quotidien (GitHub Actions)
Dépôt → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, une fois pour chacun :

| Nom | Valeur |
|---|---|
| `DATABASE_URL` | la même URI Supabase que dans `.env.local` |
| `HELIUS_API_KEY` | ta clé Helius |

Test : onglet **Actions** → « Passage quotidien » → **Run workflow**. Le passage dure ~30 à 40 min.

## 3. Site sur Vercel
1. https://vercel.com/signup → **Continue with GitHub** → offre **Hobby**.
2. **Add New… → Project** → importe `meme-journal` (autorise l'accès au dépôt si Vercel le demande).
3. Avant **Deploy**, ouvre **Environment Variables** et ajoute :

| Nom | Valeur |
|---|---|
| `DATABASE_URL` | l'URI Supabase (Transaction pooler, port 6543) |
| `APP_PASSWORD` | le mot de passe que tu veux taper pour entrer sur le site |
| `AUTH_SECRET` | une longue chaîne aléatoire (je peux t'en générer une) |

4. **Deploy**. L'adresse du site ressemble à `https://meme-journal-xxxx.vercel.app`.

## 4. Fiches Claude Code et résumé Telegram (étape 4)

Deux secrets GitHub de plus (**Settings → Secrets and variables → Actions → New repository secret**) :

| Nom | Comment l'obtenir |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Dans un terminal : `npx @anthropic-ai/claude-code setup-token`, connexion à ton compte Claude dans le navigateur, puis copie du jeton affiché (valable ~1 an). |
| `TELEGRAM_BOT_TOKEN` | Dans Telegram, conversation avec **@BotFather** → `/newbot` → un nom → un identifiant finissant par `bot` → copie du jeton. |

Puis envoie **/start** à ton nouveau bot : au passage suivant, le pipeline retrouve la conversation tout seul
(le `chat_id` est mémorisé dans les réglages, ce n'est pas un secret).

Sans ces secrets, le journal est publié normalement, sans fiches ni message Telegram.
