# Audit sources 1.6.0 - 15 juillet 2026

## Perimetre

Cette passe ajoute 20 sources et porte le registre a 96 entrees : 22 normales, 15 sociales, 8 identite/archives et 51 NSFW publiques.

Ajouts : Common Crawl, SearXNG, Lemmy, GitHub, Odysee, MusicBrainz, GDELT, Podcast Index, Fanvue, Chaturbate, Stripchat, CamSoda, LiveJasmin, Indexxx, Boobpedia, Gelbooru, Danbooru, Pixelfed, Pexels et GIPHY.

## Resultat global

Audit live sequentiel des 96 sources, avec les requetes de controle par categorie :

- 29 operationnelles;
- 3 degradees;
- 44 sans correspondance publique pour la requete testee;
- 12 avec configuration personnelle requise;
- 6 bloquees par la plateforme ou son anti-bot;
- 2 limitees par quota;
- 0 faux positif;
- 0 erreur interne.

Le rapport complet est conserve dans `docs/source-audit-v160-all-2026-07-15.md` et sa version JSON associee.

## Verification des ajouts

- Common Crawl : extraction reelle de plages WARC, 10 medias sur `NASA`; etat degrade quand certaines captures ne sont pas disponibles.
- Odysee : 5 videos publiques sur `NASA` via l'index de claims.
- Lemmy : 3 medias pertinents via API publique, avec support v4 puis v3.
- GitHub : 4 avatars/profils pertinents sans jeton personnel.
- Boobpedia : 3 medias publics sur la fiche exacte `Mia Khalifa`.
- Danbooru : 5 medias sur le test booru `hatsune miku`; images et videos sont distinguees.
- Gelbooru : l'instance testee exige actuellement un API key et un User ID personnels; l'UI le classe en configuration requise.
- SearXNG, Podcast Index, Pexels et GIPHY : adaptateurs disponibles, mais instance ou cles personnelles requises.
- GDELT : limitation HTTP 429 exposee sans interrompre la recherche.
- Indexxx : protection anti-bot exposee comme blocage, sans tentative de contournement.
- Pixelfed : fallback public actif lorsque l'API de l'instance refuse une recherche anonyme.
- Fanvue et les plateformes webcam : profils publics uniquement; aucune connexion, session partagee ni media prive n'est utilise.

## Correctifs techniques

- Le parseur WARC ne confond plus `X-Crawler-Content-Encoding` avec l'encodage du corps HTTP.
- Common Crawl ignore une capture absente et poursuit les autres URL candidates.
- Lemmy utilise les parametres propres aux API v4 et v3.
- Les limites GDELT et les demandes d'identifiants Gelbooru deviennent des diagnostics structures.
- Boobpedia tente directement le slug MediaWiki du profil.
- Les boorus conservent l'original et une miniature, y compris pour MP4/WebM.
- Les sources de profils testent le profil exact puis leur recherche publique avant les moteurs externes.
- Un acces direct bloque n'est plus masque par un fallback moteur vide.

## Verification locale

- `npm run qa` : OK.
- 30 tests Node : OK.
- 96 contrats de source uniques et 96 contrats d'adaptateur : OK.
- Protection 18+ des routes NSFW : OK.
- Registre dynamique, filtres et tiroirs DOM : OK par tests de contrat.
- Audit live complet : 96/96 sans erreur interne.

## Executable Windows

- Fichier : `dist/MediaGatherer.exe`.
- Signature PE : `MZ` valide.
- Smoke test du binaire : API 1.6.0 joignable, stockage JSON actif et 96 sources exposees.
- La taille et le SHA-256 definitifs sont publies avec la release GitHub, apres la reconstruction finale.

Le navigateur automatise integre n'a pas pu etre initialise dans cette session. La validation visuelle est donc couverte ici par les contrats DOM, les limites CSS existantes et les probes HTTP, sans pretendre a une capture navigateur reussie.

## Limites

Une source tierce peut changer son HTML, imposer une cle, limiter le debit, bloquer les robots ou ne pas contenir la personne demandee. Un zero de recherche n'est pas transforme artificiellement en resultat. MediaGatherer poursuit les autres sources et conserve la raison exacte du zero.
