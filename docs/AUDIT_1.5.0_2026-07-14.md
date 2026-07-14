# Audit MediaGatherer 1.5.0 - 2026-07-14

## Portee

Cette passe couvre la recherche publique multi-source, Person Finder, NSFW, alias, dedoublonnage, persistance Vercel, connexions officielles, frontend dynamique, tests, EXE et deploiement.

## Corrige ou ajoute

- Catalogue runtime unique: l'interface construit les tiroirs et le filtre depuis `/api/sources`.
- 73 sources: 14 normales, 11 sociales, 6 d'identite et 42 NSFW.
- APIs dediees: Wikidata, TMDB Person, Internet Archive, Arquivo.pt, Imgur, PeerTube, Bluesky, Mastodon, Tumblr, Twitch et StashDB.
- Hubs d'identite: Linktree, Beacons, AllMyLinks et Carrd.
- Sources adultes publiques: IAFD, Adult Database, ThePornDB, FanCentro, LoyalFans, ManyVids, Clips4Sale, LPSG et Adult DVD Talk, plus StashDB avec cle personnelle.
- Resolution d'identite: fusion des noms, usernames, comptes et preuves avant Person Finder.
- Protection 18+: le serveur refuse toute source NSFW sans confirmation explicite; Person Finder exige aussi une fiche adulte.
- Dedoublonnage visuel: dHash 64 bits calcule dans le navigateur apres l'affichage progressif, avec conservation du meilleur fichier.
- Stockage Vercel: hydratation et replication Upstash Redis REST optionnelles.
- Connexions: TMDB, Imgur, Tumblr, Twitch, Mastodon, PeerTube et StashDB ajoutes aux fournisseurs existants.
- Relance historique: remplacement de l'appel orphelin `initAdultSources` par le flux actuel.
- Architecture: adaptateurs API, extensions de sources, identite, perceptuel et stockage distant sortis du serveur monolithique.

## Verification reseau des 24 nouvelles sources

Requetes de controle: `NASA`, `Douglas Adams`, `sxysindy` et `mia khalifa` selon le type de source.

- 8 sources avec medias publics: Wikidata, Internet Archive, Arquivo.pt, PeerTube, Bluesky, Mastodon, Linktree et IAFD.
- 5 sources correctement classees `missing_credentials`: TMDB, Imgur, Tumblr, Twitch et StashDB.
- 11 sources joignables sans page correspondante pour le terme teste: Beacons, AllMyLinks, Carrd, Adult Database, ThePornDB, FanCentro, LoyalFans, ManyVids, Clips4Sale, LPSG et Adult DVD Talk.
- Eporner recontrole en parallele: 5 videos pertinentes via l'API publique.
- Blocage adulte recontrole: HTTP 403 sans confirmation 18+.

Un resultat vide ne devient jamais un succes media. Le diagnostic conserve le code HTTP, les pages decouvertes, les pages ouvertes, les blocages et la raison du zero.

## Tests automatiques

- Syntaxe serveur et frontend.
- Contrats API, DOM et catalogue dynamique.
- Extraction HTML et choix de l'original.
- Fixtures Bluesky, Tumblr, Imgur, PeerTube et Arquivo.pt.
- Fusion des alias avec preuves.
- Garde-fou adulte client/serveur.
- Distance de Hamming et dedoublonnage perceptuel.
- Contrat de transport pour chacune des 73 sources.

Resultat final: 22 tests sur 22, `npm audit` sans vulnerabilite et build Vercel de production valide.

## Validation executable

- `dist/MediaGatherer.exe` construit avec Node 24 x64.
- Signature de fichier Windows `MZ` valide.
- Taille: 131 948 992 octets.
- SHA-256: `1622AEF8E6B02FB6CB29DCA3C9820413A5EE68528B2C9DB0C44186D923C272BB`.
- Demarrage reel sur un port isole: accueil HTTP 200, version 1.5.0 et 73 sources exposees.

## Limites explicites

- Aucun identifiant public, partage ou divulgue n'est utilise. Les cles doivent appartenir a l'utilisateur.
- Telegram MTProto prive n'est pas integre; seules les pages de canaux publics restent traitees.
- Les apercus derriere connexion ou paywall ne sont pas contournes.
- La replication Upstash stocke le magasin personnel complet sous une cle et vise un usage individuel a faible concurrence.
- Le navigateur automatise de Codex n'a pas pu demarrer dans cette session a cause d'un chemin runtime manquant; la QA visuelle doit donc etre refaite apres deploiement avec le navigateur integre.
