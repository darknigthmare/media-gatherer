# Matrice des sources NSFW publiques

Date de verification: 2026-07-14

## Registre 1.4.1

- 49 sources au total: 10 normales, 7 reseaux sociaux et 32 NSFW.
- 32 adaptateurs NSFW declares, dont une API publique Eporner et trois transports de forum public.
- Les fallbacks moteur servent uniquement a decouvrir une page du domaine cible. Leurs images ne sont jamais retournees comme medias de cette source.

## Forums ajoutes

| Source | Transport prioritaire | Test public `mia khalifa` | Test exact `sxysindy` |
| --- | --- | --- | --- |
| Phun Forum | Recherche GET publique, 4 sujets max | 35 images originales, 4/4 sujets ouverts | 0 page correspondante |
| PlanetSuzy | Formulaire public, cookie de session, 4 sujets max | 35 images et 20 liens video publics, 4/4 sujets ouverts | 0 page correspondante |
| Bellazon | Recherche GET publique, 4 sujets max | 35 images, 4/4 sujets ouverts | 0 page correspondante |

Sur Bellazon, 33 des 35 images du test etaient des URLs originales; deux miniatures ont ete conservees uniquement quand aucun original public distinct n'etait expose.

## Matrice reelle des 32 sources

Requete: `mia khalifa`, pertinence stricte, mode NSFW public, concurrence bornee a trois sources.

Sources avec medias pertinents (17):

`babepedia`, `bellazon`, `drtuber`, `eporner`, `erome`, `hqporner`, `imagefap`, `nuvid`, `phunforum`, `planetsuzy`, `pornpics`, `spankbang`, `tnaflix`, `xhamster`, `xnxx`, `xvideos`, `youjizz`.

Sources joignables sans page publique correspondante pour cette requete (15):

`babesource`, `camwhores`, `fansly`, `freeones`, `freeonesforum`, `imagebam`, `motherless`, `mym`, `onlyfans`, `pornhub`, `pornone`, `pornzog`, `redgifs`, `tube8`, `youporn`.

Un zero dans la seconde liste n'est pas presente comme une panne: le diagnostic expose `no_matching_public_pages`, le nombre de pages trouvees/ouvertes et les transports essayes.

## Regression des faux positifs

Sur `sxysindy`:

- Instagram: 1 photo pertinente et alias public `SxySindy`.
- DrTuber: 1 apercu video rattache a la page correspondante.
- OnlyFans et Fansly: 0 media, aucun logo de plateforme.
- HQPorner: 0 media, aucune video voisine hors sujet.
- Facebook, TikTok, X et Pinterest: 0 media, aucune image generique de moteur.
- Phun Forum, PlanetSuzy et Bellazon: 0 sujet correspondant, donc aucun media aspire.

## Etats exposes

- `operational`: acces direct et media public extrait.
- `degraded`: media extrait via un fallback public.
- `empty` ou `no_matching_public_pages`: source joignable sans correspondance publique.
- `access_blocked`: reponse 401, 403 ou 451.
- `rate_limited`: limitation HTTP 429.
- `source_unreachable`: aucun transport public joignable.
- `detail_pages_without_public_media`: pages trouvees mais aucun media exploitable.

## Politique d'acces

Les adaptateurs utilisent uniquement les pages et APIs publiques. Ils ne contournent pas les connexions, paywalls, comptes prives, verifications d'age, restrictions regionales ni protections anti-bot. Une source tierce ne peut pas etre garantie disponible en permanence; MediaGatherer garantit un fallback borne, un diagnostic explicite et la poursuite des autres sources.
