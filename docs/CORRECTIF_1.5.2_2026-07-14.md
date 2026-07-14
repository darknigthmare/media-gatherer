# Correctif MediaGatherer 1.5.2 - 2026-07-14

## Regression constatee

La baisse de volume venait de trois causes distinctes :

- Bing Images ne renvoie actuellement plus d'image pertinente pour `sxysindy`; son fallback web trouve encore des pages et videos liees.
- Plusieurs adaptateurs eliminaient deja les scores inferieurs a 70 avant le filtre global. Le mode `smart` ne pouvait donc pas recuperer les medias fiables notes 50 a 69.
- Le cache serveur Vercel est volatil et le changement de schema precedent avait invalide les anciens resultats locaux.

## Corrections

- Le mode `smart` devient le mode de pertinence par defaut; `strict` reste disponible manuellement.
- Le seuil en dur des adaptateurs DuckDuckGo, Wikimedia, Flickr, Dailymotion, YouTube, Google et Brave est supprime. Un seul filtre central decide apres normalisation.
- Chaque reponse expose les nombres bruts, retenus, rejetes par pertinence et rejetes par filtres media.
- Les refreshs serveur fusionnent les resultats encore valides du cache au lieu de les remplacer par une reponse externe plus pauvre.
- Le navigateur conserve les medias 30 jours dans IndexedDB, avec une cle separee par requete, sources, type de media et contexte adulte.
- Une relance restaure d'abord le snapshot local, puis ajoute les nouveaux resultats au fil de la recherche.
- Wayback utilise maintenant `matchType=domain`, avec fallbacks joker uniquement si necessaire.
- La decouverte Wayback exploite les domaines officiels, les pages signalees par les moteurs et des domaines personnels bornes pour un username.
- Le mode Wayback NSFW exige toujours la confirmation 18+.

## Verification reelle

- `sxysindy.com`: 829 lignes CDX, 714 images utiles, 5 assets UI ignores, reponse locale en environ 1 seconde.
- `thesxysindy.weebly.com`: 8 images.
- Total archive retrouve pour le cas de regression: 722 images.
- Bing fallback `sxysindy`: 2 videos directement liees au pseudo lors du controle.
- Refresh Bing: les 2 resultats precedents restent presents avec `cacheCarryForward=true`.
- `NASA` via Bing: 33 images et 4 videos en mode intelligent lors du controle reseau.
- QA: 24 tests sur 24; `npm audit`: 0 vulnerabilite.

## Executable Windows

- Version: 1.5.2.
- Taille: 131 994 146 octets.
- Signature: `MZ`.
- SHA-256: `4268B61A5A75137EAEFE311FC83EC1F00C2D649C22ADC4FAC7562B98B271BE86`.
- Smoke test EXE: accueil et API HTTP 200, version 1.5.2, 73 sources, puis 714 images Wayback sur `sxysindy.com`.

## Limite externe restante

Bing reste une source externe non contractuelle : son HTML et ses resultats peuvent varier d'un appel a l'autre. L'application ne fabrique pas les 35 anciennes images quand Bing ne les fournit plus; elle les complete par les pages publiques, Wayback et le cache navigateur. Le navigateur automatise integre n'a pas pu etre initialise dans cette session (`Cannot redefine property: process`); la validation visuelle sera donc refaite sur la version Vercel depuis le navigateur de l'utilisateur.
