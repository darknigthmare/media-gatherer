# Audit complet des sources - 15 juillet 2026

Version auditee : `1.5.6`.

## Perimetre

- 76 sources declarees : 15 normales, 13 sociales, 6 identite/archives et 42 NSFW.
- 76 contrats d'adaptateurs exposes par `/api/sources/adapters`.
- Aucun identifiant duplique et aucun adaptateur manquant.
- Test HTTP reel de chaque source via `/api/sources/:id/test`.
- Verification des URLs, miniatures, types photo/video, pertinence de la requete, etat d'acces et raison des zeros.

## Resultat general

| Etat | Nombre | Interpretation |
| --- | ---: | --- |
| Operationnel | 24 | Medias pertinents obtenus pendant la sonde |
| Degrade | 1 | Medias obtenus avec fallback ou qualite partielle |
| Vide | 42 | Source joignable, mais aucun media public pertinent pour la requete test |
| Configuration requise | 7 | Cle ou jeton personnel absent |
| Acces bloque | 1 | Reponse publique refusee par la plateforme |
| Limite | 1 | Limitation temporaire de debit |
| Faux positif | 0 | Aucun echantillon hors sujet retenu |
| Erreur | 0 | Aucun adaptateur en erreur serveur |

Sources operationnelles pendant cette passe : Bing, Flickr, Wikimedia, YouTube, Dailymotion, Erome, ImageFap, XHamster, XVideos, SpankBang, TNAFlix, Eporner, XNXX, HQPorner, Nuvid, DrTuber, YouJizz, Phun Forum, Bellazon, Wikidata, Openverse, Internet Archive, Arquivo.pt et IAFD. PlanetSuzy a fonctionne en mode degrade.

Un etat `vide` ne signifie pas que le site ne contient rien. Il signifie que la requete temoin n'a produit aucun media public suffisamment pertinent lors de cette execution. Les pages JavaScript, les protections anti-bot, les restrictions regionales et les contenus derriere connexion restent des limites externes.

## Test cible sxysindy

La recherche a ete relancee en mode adulte (`safe=false`) sur 46 sources pertinentes :

- DuckDuckGo : 8 medias, fallback actif.
- Bing : 5 medias via le transport Images public, avec endpoint asynchrone de secours.
- Instagram : 1 media public indexe.
- Camwhores : 2 medias publics indexes par domaine.
- Fansly : 2 medias publics.
- XVideos : 1 video avec miniature.
- Linktree : 5 images de profil pertinentes.
- Faux positifs : 0.

Google, Brave et Tumblr demandaient une configuration personnelle. Reddit refusait l'acces public depuis l'environnement de test. L'API CDX Wayback repondait `429`, mais la decouverte des domaines et le flux progressif cote interface restent disponibles.

## Corrections integrees

- Ajout d'un audit live reproductible avec rapport JSON et Markdown partiel pendant l'execution.
- Ajout d'Openverse, Snapchat public et Threads public au registre.
- Contrat exact pour chaque adaptateur : transport, implementation, authentification, domaines, fallbacks et endpoint de test.
- Second transport Bing Images via `/images/async` quand la page initiale ne contient que le squelette HTML.
- Fallback Bing Images limite au domaine pour les sources JavaScript ou bloquees.
- Suppression des icones, logos, cloches de notification et banniere de sponsoring des resultats.
- Linktree limite aux vrais medias du profil et extraction des comptes sortants comme alias candidats a verifier.
- PeerTube filtre les resultats qui ignorent la requete.
- Mastodon exige que le compte corresponde au nom recherche avant d'extraire ses medias.
- Bluesky exige l'expression d'identite continue pour eviter les mots homonymes disperses.
- IAFD limite l'extraction aux fiches personne et aux photos de profil, sans les autres acteurs d'une page de titre.
- Wayback distingue limitation CDX, domaines trouves, pages archivees et absence reelle de capture.

## Configuration encore utile

Les sources suivantes necessitent un identifiant personnel officiel pour leur API : Google, Brave, TMDB, Imgur, Tumblr, Twitch et StashDB. Flickr et YouTube fonctionnent avec un fallback public, mais leurs cles officielles ameliorent la stabilite et les quotas.

Aucun compte partage, identifiant public trouve sur Internet, contournement de connexion, paywall ou compte prive n'est utilise.

## Reproduire

```powershell
npm run qa
npm run audit:sources -- --base http://127.0.0.1:3000
npm run audit:sources -- --base http://127.0.0.1:3000 --unsafe --query sxysindy
```

Rapports detailles :

- `docs/source-audit-after-fixes-2026-07-15.md`
- `docs/source-audit-after-fixes-2026-07-15.json`
- `docs/source-audit-sxysindy-after-fixes-2026-07-15.md`
- `docs/source-audit-sxysindy-after-fixes-2026-07-15.json`
