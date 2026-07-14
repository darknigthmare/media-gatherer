# MediaGatherer

MediaGatherer est une application locale Node.js/Express de recherche et de classement de medias publics. L'interface regroupe quatre modules independants :

- **Media Finder** : photos, videos, moteurs, reseaux publics, archives et recherche batch.
- **Connexions API** : Google CSE, Brave, Flickr et YouTube, avec test reel des identifiants.
- **Recherche inversee** : ouverture des moteurs inverses depuis une image choisie.
- **Person Finder** : profils publics ou consentis, alias, comptes, galerie, validation, timeline et exclusions.

Le mode NSFW public contient 32 adaptateurs par source. Il ne contourne ni connexion, ni compte prive, ni paywall.

La version 1.4.2 ajoute les recherches publiques Phun Forum, PlanetSuzy et Bellazon, compacte les longues listes de sources et de diagnostics, corrige les faux positifs NSFW et fiabilise la recuperation d'alias, y compris quand un hebergeur refuse les medias mais laisse les titres de profils publics visibles. Les redirections techniques de connexion et mentions legales sont exclues des preuves d'identite. Chaque adaptateur conserve la meilleure image connue, la page source et, lorsqu'il existe, le lecteur public integre.

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

Les identifiants saisis dans l'onglet Connexions restent en memoire de session serveur et ne sont pas exportes.

## Recherche et diagnostics

- Les resultats arrivent source par source pendant que la recherche continue.
- Les modes `strict`, `smart` et `broad` controlent la preuve textuelle exigee.
- Une page de compte publique validee peut etre extraite entierement sans imposer le nom dans chaque media.
- Wayback decouvre d'abord les domaines via la recherche officielle, puis lit les medias CDX sans filtre de nom.
- Chaque source expose un statut, le nombre brut, le nombre filtre, les pages ouvertes et une raison explicite en cas de zero.
- Les diagnostics et la longue liste NSFW sont des tiroirs a hauteur bornee avec defilement interne.
- Les sources NSFW distinguent acces direct, fallback moteur, blocage, limitation de debit et indisponibilite reseau.
- Phun Forum, PlanetSuzy et Bellazon utilisent leur recherche publique avant les fallbacks moteurs.
- Eporner utilise son API publique en priorite, puis repasse sur la recherche HTML et les moteurs publics si elle ne repond pas.
- La meilleure URL connue est conservee lors du dedoublonnage ; une miniature ne remplace pas un original.
- Les alias ne sont proposes qu'avec une preuve de profil ou de nom public ; les chemins techniques de forum sont exclus.

## Stockage

En local et dans l'EXE, l'historique, la collection, les profils, le cache, la queue et les veilles sont durables dans `data/mediagatherer.store.json`.

Sur Vercel, le stockage fichier est temporaire. L'interface l'indique explicitement : une base externe est necessaire pour conserver les donnees de production entre les instances et redeploiements.

## Securite et limites

- URLs publiques HTTP(S) uniquement, ports 80/443, redirections revalidees.
- Blocage des IP locales/privees et de leur resolution DNS.
- CORS restreint, CSP/Helmet, limites de debit et tailles de reponse bornees.
- Person Finder interdit l'adresse privee, le telephone prive et la localisation temps reel.
- Les sites qui exigent JavaScript, une connexion, une region autorisee ou qui bloquent les robots peuvent rester indisponibles. Le diagnostic doit alors l'indiquer, sans simuler de resultat.

Voir aussi [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/MEDIA_FINDER_NSFW_AUDIT.md](docs/MEDIA_FINDER_NSFW_AUDIT.md), [docs/NSFW_SOURCE_MATRIX_2026-07-14.md](docs/NSFW_SOURCE_MATRIX_2026-07-14.md) et [docs/AUDIT_2026-07-14.md](docs/AUDIT_2026-07-14.md).
