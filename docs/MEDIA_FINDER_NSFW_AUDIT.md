# Media Finder NSFW Audit

Date: 2026-07-14

## Scope

Audit fonctionnel du mode Media Finder avec focus sur les sources NSFW publiques.

Le mode NSFW reste volontairement limite a:

- contenus publics;
- pages indexables ou accessibles sans connexion;
- APIs officielles quand elles sont configurees;
- aucun contournement de login, paywall, compte prive ou protection d'acces.

## Findings

1. Plusieurs sources adultes renvoyaient zero media car l'extracteur ne lisait pas assez d'attributs lazy-loading.
   Correction: extraction de `data-src`, `data-original`, `data-lazy-src`, `data-full`, `data-large`, `srcset`, `og:image`, `twitter:image`, posters video et URLs directes image/video dans le HTML.

2. Certaines recherches directes de sites NSFW echouent avec 403, 404 ou pages JS.
   Correction: fallback public par moteur avec `site:domain` sur DuckDuckGo et Bing pour les sources NSFW.

3. Le frontend appelait `/api/proxy` pour retenter l'affichage des medias, mais la route n'existait pas dans le serveur compact.
   Correction: ajout d'un proxy media public limite aux URLs HTTP(S), avec blocage DNS/IP privees et refus des reponses non media.

4. Les sources joignables mais sans media etaient affichees comme succes ou echec generique.
   Correction: statut warning, note zero-result et diagnostic lisible.

5. SafeSearch masquait les sources NSFW sans action rapide claire pour le mode adulte public.
   Correction: bouton `Mode NSFW public`, drawer NSFW rose, note explicite, selection de sources adultes publiques prioritaires.

6. Le fallback moteur pouvait compter les miniatures ou logos du moteur comme medias de la source demandee.
   Correction: pipeline en deux etapes. L'adaptateur decouvre d'abord une page appartenant au domaine cible et contenant le terme, puis ouvre cette page avant d'extraire le media, sa miniature et sa provenance.

7. Toutes les sources adultes utilisaient auparavant le meme extracteur generique.
   Correction initiale: registre de 22 adaptateurs NSFW avec domaines, chemins de resultats, types supportes et limite de pages. La version 1.3.0 porte ce total a 29.

8. Les pages video pouvaient remonter leurs icones, SVG et videos connexes comme resultats.
   Correction: une source video ne retourne plus d'images autonomes; les images servent de miniatures. Seuls les lecteurs, embeds, URLs video directes et donnees structurees de la page cible deviennent des videos.

9. Le diagnostic d'une source exigeait une recherche complete.
   Correction: `GET /api/sources/:id/test?q=...&safe=false` retourne le mode d'adaptateur, les pages decouvertes/ouvertes, la raison d'un zero et dix echantillons maximum.

10. DuckDuckGo Images pouvait repondre avec un tableau vide alors que sa recherche web trouvait la personne.
    Correction: fallback borne sur DuckDuckGo HTML, ouverture de trois a cinq pages publiques pertinentes, extraction des medias et diagnostic `pagesDiscovered/pagesCrawled`.

11. Wayback etait limite a 200 lignes CDX et filtrait implicitement trop de medias.
    Correction: recherche officielle de domaines Wayback, lecture de 1 000 lignes CDX, aucun filtre de nom apres validation du domaine, retrait limite aux assets d'interface evidents.

12. Une URL de page video pouvait etre reutilisee comme fausse miniature.
    Correction: une video sans image reelle utilise le placeholder de l'interface; les posters et miniatures valides restent prioritaires.

13. Le registre manquait de sources video publiques encore joignables en France.
    Correction: ajout d'Eporner, XNXX, HQPorner, Nuvid, DrTuber, PornOne et YouJizz. RedTube n'a pas ete ajoute au preset car son acces public est actuellement suspendu en France.

14. Eporner exposait une API JSON publique plus stable que sa page d'age verification.
    Correction: adaptateur API v2 prioritaire avec titre, duree, lecteur integre, page source et meilleure miniature; le crawl HTML et les moteurs restent des fallbacks.

15. HQPorner associe parfois le terme recherche dans ses tags sans le repeter dans le titre de la video.
    Correction: les liens video de sa recherche interne sont consideres comme contexte valide, sans appliquer cette confiance aux resultats DuckDuckGo, Bing ou Brave.

16. Les pages video externes etaient parfois envoyees au lecteur HTML5 comme si elles etaient des fichiers MP4.
    Correction: le frontend distingue lecteur integre, media direct et lecture sur la page publique de la source.

17. Une source bloquee et une recherche vide partageaient le meme statut.
    Correction: diagnostics `access_blocked`, `rate_limited`, `source_unreachable`, `fallbackUsed` et `directReachable`.

## Verification

- `npm run qa`: 14 tests sur 14 OK.
- `npm audit`: 0 vulnerabilite.
- `/api/health`: OK.
- `/api/sources/adapters`: 46 sources, dont 29 adaptateurs NSFW (28 `source-crawl` et 1 `eporner-api-v2`).
- Recherche combinee Eporner, XNXX, HQPorner, Nuvid, DrTuber, PornOne et YouJizz sur `mia`: 102 videos publiques, toutes avec miniature, aucune photo en mode video.
- Tests unitaires: 14 sur 14 OK, incluant l'API Eporner, les nouvelles routes, le contexte de recherche HQPorner et la distinction profil/page media.
- `/api/search?q=sxysindy&sources=duckduckgo,bing&safe=false&mode=smart&fresh=1`: 35 images et 2 videos pertinentes.
- `/api/sources/erome/test?q=mz&safe=false`: 5 images originales et 5 videos MP4 publiques avec miniatures distinctes.
- `/api/wayback/hosts?q=sxysindy`: retrouve `sxysindy.tumblr.com`, `sxysindy.com`, `thesxysindy.weebly.com`, `wiccansmagic.com` et `camsoda.com`.
- `/api/wayback/cdx?domain=sxysindy.com&q=sxysindy`: 714 images publiques, 555 timestamps, aucun filtre de nom, 5 assets UI retires.
- `/api/proxy` sur image publique: OK.
- `/api/proxy` vers `127.0.0.1`: bloque.
- Audit navigateur desktop 1280x900 et mobile 390x844: aucun debordement horizontal, recherche et bouton separes, quatre onglets exclusifs, drawer NSFW rose lisible.

## Limites reelles

- Un adaptateur ne garantit pas un resultat quand le site renvoie une page vide, impose JavaScript, bloque la region ou refuse les robots.
- `OnlyFans`, `Fansly` et `MYM` restent limites aux profils et apercus publics; aucun contenu connecte ou payant n'est aspire.
- Les fallbacks DuckDuckGo, Bing et Brave servent uniquement a decouvrir une URL du domaine cible. Leurs propres images ne sont plus retournees comme medias de la source.
