# Matrice des sources NSFW publiques

Date de verification: 2026-07-14

## Nouvelles sources 1.3.0

| Source | Transport prioritaire | Fallback | Resultat du test public |
| --- | --- | --- | --- |
| Eporner | API v2 JSON publique | HTML, DuckDuckGo, Bing, Brave configure | 5 videos, 5 miniatures |
| XNXX | Recherche HTML publique | DuckDuckGo, Bing, Brave configure | 5 videos, 5 miniatures |
| HQPorner | Recherche HTML publique avec contexte de tags | DuckDuckGo, Bing, Brave configure | 5 videos, 5 miniatures |
| Nuvid | Recherche HTML publique | DuckDuckGo, Bing, Brave configure | 5 videos, 5 miniatures |
| DrTuber | Recherche HTML publique | DuckDuckGo, Bing, Brave configure | 5 videos, 5 miniatures |
| PornOne | Recherche HTML publique | DuckDuckGo, Bing, Brave configure | 5 videos, 5 miniatures |
| YouJizz | Recherche HTML publique | DuckDuckGo, Bing, Brave configure | 5 videos, 5 miniatures |

La recherche combinee avec des limites normales a retourne 102 videos et aucune photo parasite. Toutes les videos avaient une miniature. Le volume combine depasse les cinq echantillons du test unitaire par source.

## Etats exposes

- `operational`: acces direct et media public extrait.
- `degraded`: media extrait via un fallback public.
- `empty`: source joignable sans correspondance publique.
- `access_blocked`: reponse 401, 403 ou 451.
- `rate_limited`: limitation HTTP 429.
- `source_unreachable`: aucun transport public joignable.
- `detail_pages_without_public_media`: pages trouvees mais aucun media exploitable.

## Politique d'acces

Les adaptateurs utilisent uniquement les pages publiques et les APIs publiques. Ils ne contournent pas les connexions, paywalls, comptes prives, verifications d'age, restrictions regionales ni protections anti-bot. RedTube n'a pas ete ajoute au preset car son acces est actuellement suspendu en France; l'ajouter comme source active aurait produit un faux sentiment de disponibilite.

Une source tierce ne peut pas etre garantie disponible en permanence. MediaGatherer garantit plutot un fallback borne, un diagnostic explicite et la poursuite des autres sources quand l'une d'elles tombe.
