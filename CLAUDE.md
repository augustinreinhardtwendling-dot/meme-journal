@AGENTS.md

# Meme Journal

- Tout le texte visible (interface, messages, fiches) est en français.
- Budget zéro : uniquement des offres gratuites (Helius 1 M crédits/mois, GeckoTerminal 30 req/min,
  DexScreener, Supabase, Vercel Hobby, GitHub Actions). Jamais d'appel à l'API Anthropic depuis le code.
- Helius : préférer les appels RPC standards ; `getTransactionsForAddress` (10 crédits / 100 tx) remplace
  avantageusement des centaines de `getTransaction`. Toujours `maxSupportedTransactionVersion: 1`.
- Les seuils sont dans `lib/config.ts` (valeurs par défaut) et surchargés par la table `settings`.
- La détection se fait sur des fonctions pures (`lib/detection/`) testées avec vitest ; le pipeline ne fait
  que récupérer les données.
- Secrets : `.env.local` en local, secrets GitHub / variables Vercel ailleurs. Ne jamais les afficher.
