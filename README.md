# MediaGatherer

MediaGatherer est une application locale Node.js/Express de recherche et de classement de medias publics. L'interface regroupe quatre modules independants :

- **Media Finder** : photos, videos, moteurs, reseaux publics, archives et recherche batch.
- **Connexions API** : moteurs, plateformes sociales, archives et bases d'identite, avec test reel des identifiants personnels.
- **Recherche inversee** : ouverture des moteurs inverses depuis une image choisie.
- **Person Finder** : profils publics ou consentis, alias, comptes, galerie, validation, timeline et exclusions.

Le registre contient 96 sources : 22 normales, 15 sociales, 8 d'identite et 51 NSFW publiques. Il ne contourne ni connexion, ni compte prive, ni paywall.

La version 1.6.1 rend les alias actionnables de bout en bout : nouvelle recherche, ajout aux resultats courants, transfert structure vers Person Finder, validation, rejet durable et preuves accessibles. La version 1.6.0 avait ajoute Common Crawl, SearXNG, Lemmy, GitHub, Odysee, MusicBrainz, GDELT, Podcast Index, Pixelfed, Pexels, GIPHY, Fanvue, cinq plateformes de profils webcam publics, Indexxx, Boobpedia, Gelbooru et Danbooru. Le moteur Google Programmable Search `155c4d451e53743c2` reste le CX public par defaut et requiert une cle `GOOGLE_API_KEY` personnelle.

## Demarrage local

Prerequis : Node.js 24 recommande.

```powershell
npm install
npm start
```

Ouvrir ensuite [http://localhost:3000](http://localhost:3000).

## Verification

```powershell
npm run qa
npm audit
npm run audit:sources -- --base http://127.0.0.1:3000
```

Pour une requete adulte sur les moteurs generaux, utiliser aussi `--unsafe --query <terme>` afin de reproduire le mode NSFW de l'application.

`npm run qa` verifie la syntaxe du serveur et du frontend, puis execute les tests Node des contrats API/DOM, des icones, de la pertinence, des alias, du dedoublonnage, des exports et de la protection SSRF.

## Executable Windows

```powershell
npm run build:exe
```

Le binaire autonome est cree dans `dist/MediaGatherer.exe`. Au premier lancement, les donnees sont creees dans `dist/data/`, a cote du binaire. Le fichier EXE n'est pas versionne dans Git : il est destine aux releases GitHub.

## Configuration

Copier les valeurs utiles de `.env.example` dans `.env` :

- `PORT` : port local, `3000` par defaut.
- `MEDIAGATHERER_DATA_DIR` : dossier de stockage local personnalise.
- `CORS_ORIGINS` : origines navigateur autorisees, separees par des virgules.
- `APP_WRITE_TOKEN` : protection facultative des routes de modification.
- `GOOGLE_API_KEY` : cle requise pour Google Programmable Search. `GOOGLE_CX` est facultatif et remplace le moteur public preconfigure `155c4d451e53743c2`.
- `BRAVE_API_KEY`, `FLICKR_API_KEY`, `YOUTUBE_API_KEY` : APIs officielles correspondantes.
- `TMDB_API_KEY`, `IMGUR_CLIENT_ID`, `TUMBLR_API_KEY` : metadonnees et medias publics correspondants.
- `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET` : app auth Twitch Helix pour les clips publics.
- `MASTODON_INSTANCE` et `MASTODON_ACCESS_TOKEN` : instance et jeton personnel facultatif pour la resolution distante.
- `PEERTUBE_INSTANCE` : instance PeerTube interrogee.
- `SEARXNG_INSTANCE` : URL d'une instance personnelle/autorisant la sortie JSON.
- `LEMMY_INSTANCE` et `LEMMY_ACCESS_TOKEN` : instance Lemmy et jeton personnel facultatif.
- `PIXELFED_INSTANCE` et `PIXELFED_ACCESS_TOKEN` : instance Pixelfed et jeton personnel facultatif.
- `GITHUB_TOKEN` : jeton personnel facultatif, utile pour augmenter le quota de recherche d'utilisateurs publics.
- `PODCAST_INDEX_API_KEY` et `PODCAST_INDEX_API_SECRET` : identifiants officiels Podcast Index.
- `PEXELS_API_KEY` et `GIPHY_API_KEY` : cles officielles pour leurs recherches photo/video/GIF.
- `GELBOORU_API_KEY`, `GELBOORU_USER_ID`, `DANBOORU_LOGIN` et `DANBOORU_API_KEY` : identifiants personnels facultatifs pour les quotas des API booru.
- `STASHDB_API_KEY` : votre cle personnelle StashDB; aucune cle partagee n'est fournie.
- `KV_REST_API_URL` et `KV_REST_API_TOKEN` : stockage Upstash Redis REST durable sur Vercel.

Les identifiants saisis dans l'onglet Connexions restent en memoire de session serveur et ne sont pas exportes.

## Recherche et diagnostics

- Les resultats arrivent source par source pendant que la recherche continue.
- Les modes `strict`, `smart` et `broad` controlent la preuve textuelle exigee; `smart` est le mode par defaut afin de conserver les medias d'un compte public valide.
- Une page de compte publique validee peut etre extraite entierement sans imposer le nom dans chaque media.
- Wayback decouvre d'abord les domaines via la recherche officielle, complete les usernames avec des domaines personnels probables, puis lit les medias CDX avec `matchType=domain`, sans filtre de nom.
- Chaque source expose un statut, le nombre brut, le nombre retenu, les pages ouvertes et une raison explicite en cas de zero.
- `/api/sources/adapters` indique le transport reel, l'authentification, l'etat de configuration, les domaines et les fallbacks de chaque source.
- L'audit live verifie aussi la pertinence des echantillons, les miniatures manquantes et les faux positifs, au lieu de se limiter au code HTTP.
- Le navigateur conserve pendant 30 jours les resultats par requete, selection de sources et niveau adulte; une relance ou un refresh les restaure avant d'ajouter les nouveautes.
- Les diagnostics et la longue liste NSFW sont des tiroirs a hauteur bornee avec defilement interne.
- Les sources NSFW distinguent acces direct, fallback moteur, blocage, limitation de debit et indisponibilite reseau.
- Phun Forum, PlanetSuzy et Bellazon utilisent leur recherche publique avant les fallbacks moteurs.
- Eporner utilise son API publique en priorite, puis repasse sur la recherche HTML et les moteurs publics si elle ne repond pas.
- La meilleure URL connue est conservee lors du dedoublonnage ; une miniature ne remplace pas un original.
- Les alias ne sont proposes qu'avec une preuve de profil ou de nom public ; les liens sortants des hubs publics restent des candidats a verifier et les chemins techniques de forum sont exclus.
- Un alias trouve ouvre un panneau d'actions : rechercher, fusionner ses medias avec les resultats visibles, l'envoyer vers une fiche Person Finder ou le rejeter. La confiance, les sources et les preuves restent attachees au candidat.
- Person Finder separe les alias a verifier, confirmes et rejetes. Un alias confirme devient un terme de recherche direct; un rejet n'est pas reintroduit silencieusement par la resolution d'identite suivante.
- La resolution d'identite croise Wikidata, les reseaux publics et les hubs de liens avant la recherche Person Finder.
- Les empreintes dHash sont calculees apres affichage via le proxy local, sans retarder l'arrivee progressive des resultats.

## Stockage

En local et dans l'EXE, l'historique, la collection, les profils, le cache, la queue et les veilles sont durables dans `data/mediagatherer.store.json`.

Sur Vercel, le stockage fichier est temporaire. Si `KV_REST_API_URL` et `KV_REST_API_TOKEN` sont configures, l'application hydrate et replique le magasin JSON dans Upstash Redis REST avant de repondre aux mutations. Sans ces variables, l'interface continue d'indiquer le mode volatil.

## Securite et limites

- URLs publiques HTTP(S) uniquement, ports 80/443, redirections revalidees.
- Blocage des IP locales/privees et de leur resolution DNS.
- CORS restreint, CSP/Helmet, limites de debit et tailles de reponse bornees.
- Person Finder interdit l'adresse privee, le telephone prive et la localisation temps reel.
- Les recherches NSFW sont bloquees sans confirmation 18+; une fiche Person Finder doit aussi etre explicitement marquee adulte avant d'interroger ces sources.
- Les sites qui exigent JavaScript, une connexion, une region autorisee ou qui bloquent les robots peuvent rester indisponibles. Le diagnostic doit alors l'indiquer, sans simuler de resultat.

Voir aussi [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/AUDIT_SOURCES_1.6.0_2026-07-15.md](docs/AUDIT_SOURCES_1.6.0_2026-07-15.md), [docs/MEDIA_FINDER_NSFW_AUDIT.md](docs/MEDIA_FINDER_NSFW_AUDIT.md) et [docs/NSFW_SOURCE_MATRIX_2026-07-14.md](docs/NSFW_SOURCE_MATRIX_2026-07-14.md).
