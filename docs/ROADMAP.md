# Etat et suite

## Integre dans la version 1.4.2

- Media Finder, Connexions API, Recherche inversee et Person Finder dans quatre onglets exclusifs.
- Resultats progressifs par source, recherche batch, queue, cache, historique, collection, veilles et exports.
- Modes photo, video ou mixte, pertinence stricte/intelligente/large et conservation de la meilleure qualite.
- Recherche Wayback par terme, domaines officiels et extraction CDX sans filtre de nom apres validation du site.
- 32 adaptateurs NSFW publics avec extraction image/video, meilleure image connue, pages decouvertes et raison des zeros.
- Eporner API v2 prioritaire, plus XNXX, HQPorner, Nuvid, DrTuber, PornOne et YouJizz en HTML public.
- Recherches publiques Phun Forum, PlanetSuzy et Bellazon, avec crawl borne des sujets correspondants.
- Tiroirs defilables pour la liste NSFW, la repartition des sources et les diagnostics.
- Alias deduits uniquement depuis une preuve de profil ou de nom public; chemins de forum exclus.
- Etats distincts pour acces direct, fallback actif, blocage, limitation et source indisponible.
- Profils Person Finder, alias detectes ou saisis, comptes publics, score, galerie, timeline, validation et exclusions.
- Securite HTTP, SSRF, CORS, CSP, rate limits, limites de taille et token d'ecriture facultatif.
- Executable Windows Node 24 autonome et workflow GitHub Actions.

## Limites externes connues

- Le stockage Vercel reste temporaire sans base externe.
- Telegram MTProto n'est pas active : une application Telegram et une session utilisateur autorisee seraient necessaires. Aucun compte prive ne doit etre aspire.
- Google, Brave, Flickr et YouTube donnent de meilleurs resultats avec leurs identifiants API officiels.
- Une source peut bloquer les robots, imposer JavaScript, un compte, un paywall ou une restriction regionale. Le diagnostic l'indique sans tenter de contourner la protection.

## Prochaines evolutions utiles

1. Brancher une base durable compatible Vercel et migrer le magasin JSON local.
2. Decouper progressivement `server.js` en routes, services et adaptateurs testes sans changer les contrats API.
3. Ajouter des tests d'integration enregistres par source avec reponses HTML fixturees pour detecter les changements de structure.
4. Ajouter un client Telegram public opt-in, uniquement via API officielle et session locale explicite.
5. Signer l'EXE Windows pour supprimer l'avertissement SmartScreen des binaires non signes.
