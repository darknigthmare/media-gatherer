# Media Finder NSFW Audit

Date: 2026-07-10

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
   Correction: registre de 22 adaptateurs NSFW avec domaines, chemins de resultats, types supportes et limite de pages. Ajout de Pornhub, YouPorn, Tube8, TNAFlix et Motherless.

8. Les pages video pouvaient remonter leurs icones, SVG et videos connexes comme resultats.
   Correction: une source video ne retourne plus d'images autonomes; les images servent de miniatures. Seuls les lecteurs, embeds, URLs video directes et donnees structurees de la page cible deviennent des videos.

9. Le diagnostic d'une source exigeait une recherche complete.
   Correction: `GET /api/sources/:id/test?q=...&safe=false` retourne le mode d'adaptateur, les pages decouvertes/ouvertes, la raison d'un zero et dix echantillons maximum.

## Verification

- `npm run check`: OK.
- `/api/health`: OK.
- `/api/sources/adapters`: 39 sources, dont 22 adaptateurs NSFW `source-crawl`.
- `/api/search?q=mia%20khalifa&sources=tnaflix&safe=false&media=both&fresh=1`: 6 videos, 6 miniatures, aucune image parasite sur l'environnement de test.
- `/api/search?q=sxysindy&sources=erome&safe=true&media=both&fresh=1`: source ignoree par SafeSearch.
- `/api/proxy` sur image publique: OK.
- `/api/proxy` vers `127.0.0.1`: bloque.

## Visual Audit Limit

La capture via navigateur integre Codex a echoue avec une erreur d'outil: `failed to write kernel assets: Le chemin d'acces specifie est introuvable`.

L'audit visuel complet avec captures doit etre relance quand le navigateur integre est disponible.

## Limites reelles

- Un adaptateur ne garantit pas un resultat quand le site renvoie une page vide, impose JavaScript, bloque la region ou refuse les robots.
- `OnlyFans`, `Fansly` et `MYM` restent limites aux profils et apercus publics; aucun contenu connecte ou payant n'est aspire.
- Les fallbacks DuckDuckGo, Bing et Brave servent uniquement a decouvrir une URL du domaine cible. Leurs propres images ne sont plus retournees comme medias de la source.
