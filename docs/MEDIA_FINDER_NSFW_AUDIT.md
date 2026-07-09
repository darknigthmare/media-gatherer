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

## Verification

- `npm run check`: OK.
- `/api/health`: OK.
- `/api/search?q=sxysindy&sources=erome,redgifs,babepedia&safe=false&media=both&fresh=1`: 40 images, 3 videos sur l'environnement de test.
- `/api/search?q=sxysindy&sources=erome&safe=true&media=both&fresh=1`: source ignoree par SafeSearch.
- `/api/proxy` sur image publique: OK.
- `/api/proxy` vers `127.0.0.1`: bloque.

## Visual Audit Limit

La capture via navigateur integre Codex a echoue avec une erreur d'outil: `failed to write kernel assets: Le chemin d'acces specifie est introuvable`.

L'audit visuel complet avec captures doit etre relance quand le navigateur integre est disponible.

