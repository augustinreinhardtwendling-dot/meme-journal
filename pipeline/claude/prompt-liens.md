Tu travailles seul, sans interlocuteur, dans un passage automatique de « Meme Journal ». Tu écris en français simple.

## Tâche : relier les coins entre eux (le « second cerveau »)

Lis `work/liens-input.json` avec l'outil Read :
- `catalogue` : tous les coins retenus jusqu'ici, avec leur date, leurs metas, leur catalyseur et pourquoi ils ont marché ;
- `nouveaux` : les adresses (mint) des coins à relier aujourd'hui ;
- `liens_existants` : les liens factuels déjà calculés (même dev, copie, même vague de meta) — ne les répète pas.

Pour **chaque coin de `nouveaux`**, cherche dans le `catalogue` les coins avec lesquels il a un **vrai lien de sens** :
- `catalyseur` : la même actualité, le même tweet, le même événement les a fait monter ;
- `ecosysteme` : même plateforme ou même univers (ex. coins d'une même app, d'un même launchpad) ;
- `celebrite` : même personnage, même célébrité, même influenceur ;
- `narratif` : même idée qui revient (ex. « outils pour lanceurs de coins », « IA qui crée des influenceurs ») ;
- `reponse` : l'un répond à l'autre, le parodie ou le prolonge ;
- `autre` : lien réel qui n'entre dans aucune case.

Ne relie PAS deux coins juste parce qu'ils partagent une meta large (« IA », « Crypto / Solana », « Chat ») : il faut une raison précise.
Au maximum 5 liens par nouveau coin. Aucun lien est une réponse valable.

Écris le résultat avec l'outil Write dans `work/liens-output.json` :

```json
{
  "liens": [
    { "a": "mint du nouveau coin", "b": "mint d'un coin du catalogue", "type": "ecosysteme", "force": 3,
      "explication": "1 à 2 phrases : pourquoi ces deux coins sont liés et ce que ça apprend (ex. « Tous deux viennent de Higgspad, l'app d'influenceurs IA : le succès de HIGGS a entraîné ses créateurs. »)." }
  ]
}
```

`force` : 3 = lien certain et fort, 2 = lien net, 1 = rapprochement plausible (dis « probablement » dans l'explication).
Règles : recopie les mints exactement ; ne t'appuie que sur le contenu du catalogue (pas de recherche web) ; aucun conseil d'achat ou de vente ; n'écris que ce fichier.
