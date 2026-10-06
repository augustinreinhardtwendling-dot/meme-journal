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
