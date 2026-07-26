# Etat et suite

## Integre jusqu'a la version 1.8.0

- Media Finder, Connexions API, Recherche inversee et Person Finder dans quatre onglets exclusifs.
- Resultats progressifs par source, recherche batch, queue cooperative par etapes, cache, historique, collection, veilles et exports.
- Galeries photo et video a hauteur responsive bornee, avec defilement interne independant et navigation clavier.
- Google Programmable Search preconfigure avec le CX fourni, surcharge possible et SafeSearch synchronise avec le mode de recherche.
- Modes photo, video ou mixte, pertinence stricte/intelligente/large et conservation de la meilleure qualite.
- Pertinence intelligente par defaut et seuil unique applique apres les adaptateurs, sans double filtrage en dur.
- Recherche Wayback par terme, domaines officiels ou personnels probables et extraction CDX rapide par domaine sans filtre de nom apres validation du site.
- Cache navigateur IndexedDB separe par requete, sources et niveau adulte, restaure pendant les recherches et complete par le refresh.
- Diagnostics bruts/retenus/rejetes pour expliquer precisement les baisses de volume.
- 52 sources NSFW publiques avec extraction image/video, meilleure image connue, pages decouvertes et raison des zeros.
- Eporner API v2 prioritaire, plus XNXX, HQPorner, Nuvid, DrTuber, PornOne et YouJizz en HTML public.
- Recherches publiques Phun Forum, PlanetSuzy et Bellazon, avec crawl borne des sujets correspondants.
- 97 sources au total, classees en moteurs generaux, reseaux sociaux, identite/archives et NSFW.
- Coomer public profiles sur `site1.coomer.com.co`, limite aux metadonnees d'identite d'un profil exact; aucune publication issue d'un miroir de contenu payant n'est reextraite.
- Openverse via API publique, plus Snapchat et Threads en profils publics.
- Audit live reproductible de toutes les sources, avec etats operationnel, degrade, vide, configuration, blocage, limitation, faux positif et erreur.
- Second transport Bing Images asynchrone et fallback indexe limite au domaine pour les sites rendus en JavaScript.
- Verification d'identite stricte pour Bluesky, Mastodon, PeerTube et IAFD afin d'eliminer les correspondances partielles.
- Adaptateurs API publics pour Wikidata, Internet Archive, Arquivo.pt, Bluesky, Mastodon et PeerTube.
- Adaptateurs optionnels avec identifiants personnels pour TMDB, Imgur, Tumblr, Twitch et StashDB.
- Resolution d'identite centralisee : alias confirmes, comptes publics a verifier, preuves et fusion avec Person Finder.
- Anti-homonymes Wikidata/TMDB : une seule identite principale est retenue selon le nom, l'annee, les mots-cles, les exclusions et la qualite de l'entite.
- Confirmation explicite de majorite avant toute recherche NSFW, y compris en batch, queue et diagnostic de source.
- Dedoublonnage perceptuel optionnel des images en plus des URL et signatures visuelles.
- Tiroirs defilables pour la liste NSFW, la repartition des sources et les diagnostics.
- Alias deduits uniquement depuis une preuve de profil ou de nom public; chemins de forum exclus.
- Workflow d'alias complet : candidats structures, provenance, recherche de remplacement, fusion aux resultats, pont Media Finder vers Person Finder, confirmation, rejet et suppression.
- Tiroir de validation des alias par fiche personne et relance directe de Media Finder depuis chaque alias confirme ou candidat.
- Etats distincts pour acces direct, fallback actif, blocage, limitation et source indisponible.
- Profils Person Finder, alias detectes ou saisis, comptes publics, score, galerie progressive, preuves, timeline, validation, exclusions, graphe relationnel public et rapport exportable.
- Validation stricte des profils Person Finder, recherche NSFW interdite si la majorite est impossible a confirmer et plans de sources distincts selon la profondeur.
- Identifiants de connexion isoles par session HTTP et jamais persistants dans le stockage partage.
- Deverrouillage d'ecriture par cookie `HttpOnly` depuis Connexions lorsque `APP_WRITE_TOKEN` est configure.
- Historique, collection, profils, queue et veilles Vercel isoles par session navigateur, y compris dans des cles Redis distinctes.
- Telegram Web public borne par username exact, avec medias, miniatures, compte et URLs de message comme preuves.
- Plan Person Finder source-aware et equitable entre nom, alias, usernames et comptes; aucun couple non execute n'est masque.
- Historique de couverture Person Finder par identite/source avec planification, interrogation, skip, erreur et volume de resultats.
- Canari public adapte a chacun des 97 transports, audit de contrats hors ligne et workflow GitHub hebdomadaire.
- Classification de qualite `original confirme`, `meilleure version declaree`, `miniature seulement` ou `non verifiee`, completee par la mesure navigateur.
- Veille locale automatique de 15 minutes a une semaine, sans chevauchement, avec baseline et liste des nouveaux medias.
- Registre des sources, planificateur/execution Person Finder, qualite media et routeur de veille extraits de `server.js`.
- Collections du stockage local bornees, proxy media limite a 32 Mo et embeds video restreints aux domaines approuves.
- Securite HTTP, SSRF, CORS, CSP, rate limits, limites de taille et token d'ecriture facultatif.
- Executable Windows Node 24 autonome, workflow GitHub Actions Linux/Windows et signature Authenticode optionnelle avant checksum.
- Stockage distant optionnel par API REST Upstash Redis, avec fallback JSON local durable dans l'EXE.
- Tests de contrat garantissant qu'aucune source declaree n'est sans transport de recherche.

## Limites externes connues

- Le stockage Vercel reste temporaire, mais isole par navigateur, tant que les conditions Marketplace Upstash ne sont pas acceptees et que les variables Redis ne sont pas injectees.
- Telegram Web public est actif. MTProto reste volontairement optionnel : une application Telegram et une session utilisateur autorisee seraient necessaires pour des fonctions officielles supplementaires. Aucun compte prive ne doit etre aspire.
- Google, Brave, Flickr et YouTube donnent de meilleurs resultats avec leurs identifiants API officiels.
- Une source peut bloquer les robots, imposer JavaScript, un compte, un paywall ou une restriction regionale. Le diagnostic l'indique sans tenter de contourner la protection.
- Reddit peut refuser son JSON public selon l'adresse IP; Wayback CDX peut repondre `429`. Ces etats sont exposes separement des vrais zeros.

## Prochaines evolutions utiles

1. Accepter les conditions Marketplace Upstash sur le compte Vercel, puis relancer le provisioning.
2. Continuer le decoupage des routes collection, exports et Person Finder hors de `server.js`.
3. Enrichir progressivement les fixtures HTML des sources qui changent apres une regression constatee par le workflow planifie.
4. Fournir un certificat de signature de code dans les secrets GitHub pour activer la signature deja integree.
5. Valider les adaptateurs avec identifiants sur les comptes API personnels du proprietaire de l'application.
