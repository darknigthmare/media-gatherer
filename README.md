# MediaGatherer

MediaGatherer est une application locale Node.js/Express de recherche et de classement de medias publics. L'interface regroupe quatre modules independants :

- **Media Finder** : photos, videos, moteurs, reseaux publics, archives et recherche batch.
- **Connexions API** : moteurs, plateformes sociales, archives et bases d'identite, avec test reel des identifiants personnels.
- **Recherche inversee** : ouverture des moteurs inverses depuis une image choisie.
- **Person Finder** : profils publics ou consentis, alias, comptes, galerie, validation, timeline et exclusions.

Le registre contient 73 sources : 14 normales, 11 sociales, 6 d'identite et 42 NSFW publiques. Il ne contourne ni connexion, ni compte prive, ni paywall.

La version 1.5.3 restaure les volumes utiles du Media Finder : pertinence intelligente par defaut, suppression du double filtrage des adaptateurs, cache de recherche durable dans le navigateur et requetes Wayback CDX rapides par domaine. Sur le cas de regression `sxysindy`, les domaines officiels retrouves rendent de nouveau les 722 images archivees attendues. Le hotfix exclut aussi les liens d'action dont un parametre contient une URL video. Les alias restent fusionnes avec leur preuve, les images peuvent etre dedoublonnees par dHash dans le navigateur et tout acces NSFW exige une confirmation 18+ explicite.

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
```

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
- `GOOGLE_API_KEY` et `GOOGLE_CX` : Google Custom Search.
- `BRAVE_API_KEY`, `FLICKR_API_KEY`, `YOUTUBE_API_KEY` : APIs officielles correspondantes.
- `TMDB_API_KEY`, `IMGUR_CLIENT_ID`, `TUMBLR_API_KEY` : metadonnees et medias publics correspondants.
- `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET` : app auth Twitch Helix pour les clips publics.
- `MASTODON_INSTANCE` et `MASTODON_ACCESS_TOKEN` : instance et jeton personnel facultatif pour la resolution distante.
- `PEERTUBE_INSTANCE` : instance PeerTube interrogee.
- `STASHDB_API_KEY` : votre cle personnelle StashDB; aucune cle partagee n'est fournie.
- `KV_REST_API_URL` et `KV_REST_API_TOKEN` : stockage Upstash Redis REST durable sur Vercel.

Les identifiants saisis dans l'onglet Connexions restent en memoire de session serveur et ne sont pas exportes.

## Recherche et diagnostics

- Les resultats arrivent source par source pendant que la recherche continue.
- Les modes `strict`, `smart` et `broad` controlent la preuve textuelle exigee; `smart` est le mode par defaut afin de conserver les medias d'un compte public valide.
- Une page de compte publique validee peut etre extraite entierement sans imposer le nom dans chaque media.
- Wayback decouvre d'abord les domaines via la recherche officielle, complete les usernames avec des domaines personnels probables, puis lit les medias CDX avec `matchType=domain`, sans filtre de nom.
- Chaque source expose un statut, le nombre brut, le nombre retenu, les pages ouvertes et une raison explicite en cas de zero.
- Le navigateur conserve pendant 30 jours les resultats par requete, selection de sources et niveau adulte; une relance ou un refresh les restaure avant d'ajouter les nouveautes.
- Les diagnostics et la longue liste NSFW sont des tiroirs a hauteur bornee avec defilement interne.
- Les sources NSFW distinguent acces direct, fallback moteur, blocage, limitation de debit et indisponibilite reseau.
- Phun Forum, PlanetSuzy et Bellazon utilisent leur recherche publique avant les fallbacks moteurs.
- Eporner utilise son API publique en priorite, puis repasse sur la recherche HTML et les moteurs publics si elle ne repond pas.
- La meilleure URL connue est conservee lors du dedoublonnage ; une miniature ne remplace pas un original.
- Les alias ne sont proposes qu'avec une preuve de profil ou de nom public ; les chemins techniques de forum sont exclus.
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

Voir aussi [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/MEDIA_FINDER_NSFW_AUDIT.md](docs/MEDIA_FINDER_NSFW_AUDIT.md), [docs/NSFW_SOURCE_MATRIX_2026-07-14.md](docs/NSFW_SOURCE_MATRIX_2026-07-14.md) et [docs/AUDIT_2026-07-14.md](docs/AUDIT_2026-07-14.md).
