# Etat et suite

## Integre dans la version 1.5.4

- Media Finder, Connexions API, Recherche inversee et Person Finder dans quatre onglets exclusifs.
- Resultats progressifs par source, recherche batch, queue, cache, historique, collection, veilles et exports.
- Galeries photo et video a hauteur responsive bornee, avec defilement interne independant et navigation clavier.
- Modes photo, video ou mixte, pertinence stricte/intelligente/large et conservation de la meilleure qualite.
- Pertinence intelligente par defaut et seuil unique applique apres les adaptateurs, sans double filtrage en dur.
- Recherche Wayback par terme, domaines officiels ou personnels probables et extraction CDX rapide par domaine sans filtre de nom apres validation du site.
- Cache navigateur IndexedDB separe par requete, sources et niveau adulte, restaure pendant les recherches et complete par le refresh.
- Diagnostics bruts/retenus/rejetes pour expliquer precisement les baisses de volume.
- 42 sources NSFW publiques avec extraction image/video, meilleure image connue, pages decouvertes et raison des zeros.
- Eporner API v2 prioritaire, plus XNXX, HQPorner, Nuvid, DrTuber, PornOne et YouJizz en HTML public.
- Recherches publiques Phun Forum, PlanetSuzy et Bellazon, avec crawl borne des sujets correspondants.
- 73 sources au total, classees en moteurs generaux, reseaux sociaux, identite/archives et NSFW.
- Adaptateurs API publics pour Wikidata, Internet Archive, Arquivo.pt, Bluesky, Mastodon et PeerTube.
- Adaptateurs optionnels avec identifiants personnels pour TMDB, Imgur, Tumblr, Twitch et StashDB.
- Resolution d'identite centralisee : alias, comptes publics, preuves et fusion avec Person Finder.
- Anti-homonymes Wikidata/TMDB : une seule identite principale est retenue selon le nom, l'annee, les mots-cles, les exclusions et la qualite de l'entite.
- Confirmation explicite de majorite avant toute recherche NSFW, y compris en batch, queue et diagnostic de source.
- Dedoublonnage perceptuel optionnel des images en plus des URL et signatures visuelles.
- Tiroirs defilables pour la liste NSFW, la repartition des sources et les diagnostics.
- Alias deduits uniquement depuis une preuve de profil ou de nom public; chemins de forum exclus.
- Etats distincts pour acces direct, fallback actif, blocage, limitation et source indisponible.
- Profils Person Finder, alias detectes ou saisis, comptes publics, score, galerie, timeline, validation et exclusions.
- Securite HTTP, SSRF, CORS, CSP, rate limits, limites de taille et token d'ecriture facultatif.
- Executable Windows Node 24 autonome et workflow GitHub Actions.
- Stockage distant optionnel par API REST Upstash Redis, avec fallback JSON/SQLite local.
- Tests de contrat garantissant qu'aucune source declaree n'est sans transport de recherche.

## Limites externes connues

- Le stockage Vercel reste temporaire tant que les variables Upstash Redis ne sont pas configurees sur le projet.
- Telegram MTProto n'est pas active : une application Telegram et une session utilisateur autorisee seraient necessaires. Aucun compte prive ne doit etre aspire.
- Google, Brave, Flickr et YouTube donnent de meilleurs resultats avec leurs identifiants API officiels.
- Une source peut bloquer les robots, imposer JavaScript, un compte, un paywall ou une restriction regionale. Le diagnostic l'indique sans tenter de contourner la protection.

## Prochaines evolutions utiles

1. Provisionner Upstash Redis sur Vercel et renseigner `KV_REST_API_URL` et `KV_REST_API_TOKEN`.
2. Continuer le decoupage de `server.js` : les nouveaux adaptateurs, l'identite et le stockage distant sont deja modules.
3. Etendre les fixtures HTML/API aux sources qui changent souvent et ajouter une surveillance de contrat planifiee.
4. Ajouter un client Telegram public opt-in, uniquement via API officielle et session locale explicite.
5. Signer l'EXE Windows pour supprimer l'avertissement SmartScreen des binaires non signes.
6. Valider les adaptateurs avec identifiants sur les comptes API personnels du proprietaire de l'application.
