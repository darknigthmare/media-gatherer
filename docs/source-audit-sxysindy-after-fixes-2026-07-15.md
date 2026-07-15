# Audit live des sources MediaGatherer

Date: 2026-07-15T00:51:56.707Z

Base testee: `http://127.0.0.1:3012`

Sources: 46; operational: 5; degradees: 2; faux positifs: 0; vides: 34; configuration requise: 3; bloquees: 1; limitees: 1; erreurs: 0.

| Source | Categorie | Adaptateur | Requete | Etat | HTTP | Photos | Videos | Echantillons pertinents | Miniatures absentes | Pages | Raison |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| duckduckgo | normal | duckduckgo-images | sxysindy | degraded | 200 | 4 | 4 | 8/8 | 3 | 1/3 | Endpoint public DuckDuckGo Images; 3 pages web, 1 ouvertes |
| bing | normal | bing-images | sxysindy | operational | 200 | 5 | 0 | 5/5 | 0 | 0/0 | Bing Images HTTP 200 |
| google | normal | google-cse | sxysindy | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| brave | normal | brave-images-api | sxysindy | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| reddit | social | reddit-json | sxysindy | access_blocked | 200 | 0 | 0 | 0/0 | 0 | 0/0 | access_blocked |
| telegram | social | public-profile-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| instagram | social | public-profile-crawl | sxysindy | operational | 200 | 1 | 0 | 1/1 | 0 | 6/6 | scan public; www.instagram.com: HTTP 200; duckduckgo.com: HTTP 200; www.bing.com: HTTP 200; bing.com/images: HTTP 200; 0 media indexe |
| facebook | social | public-search-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| tiktok | social | public-search-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| x | social | public-search-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| pinterest | social | public-search-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| snapchat | social | public-profile-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| threads | social | public-profile-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| wayback | normal | wayback-cdx | sxysindy | rate_limited | 200 | 0 | 0 | 0/0 | 0 | 0/4 | rate_limited |
| freeones | nsfw | source-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| freeonesforum | nsfw | source-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| erome | nsfw | source-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| redgifs | nsfw | source-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| babepedia | nsfw | source-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| camwhores | nsfw | source-crawl | sxysindy | degraded | 200 | 0 | 2 | 2/2 | 0 | 0/0 | 0 pages correspondantes; 0 ouvertes; www.camwhores.tv: HTTP 403; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200; bing.com/images: HTTP 200; 2 media indexe |
| onlyfans | nsfw | source-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| fansly | nsfw | source-crawl | sxysindy | operational | 200 | 2 | 0 | 2/2 | 0 | 0/0 | 0 pages correspondantes; 0 ouvertes; fansly.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200; profils publics uniquement |
| mym | nsfw | source-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| xvideos | nsfw | source-crawl | sxysindy | operational | 200 | 0 | 1 | 1/1 | 0 | 1/1 | 1 pages correspondantes; 1 ouvertes; www.xvideos.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| eporner | nsfw | eporner-api-v2 | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| phunforum | nsfw | public-forum-get | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| planetsuzy | nsfw | public-forum-form | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| bellazon | nsfw | public-forum-get | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| wikidata | identity | wikidata-api | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_media |
| openverse | normal | openverse-api | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_media |
| internetarchive | normal | archive-org-api | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_media |
| arquivo | normal | arquivo-api | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_media |
| bluesky | social | bluesky-api | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_media |
| mastodon | social | mastodon-api | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_media |
| tumblr | social | tumblr-api | sxysindy | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| linktree | identity | public-profile-crawl | sxysindy | operational | 200 | 5 | 0 | 5/5 | 0 | 0/0 | 0 pages correspondantes; 0 ouvertes; linktr.ee: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200; profils publics uniquement |
| beacons | identity | public-profile-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| allmylinks | identity | public-profile-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| carrd | identity | public-profile-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| iafd | nsfw | public-metadata-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| theporndb | nsfw | public-metadata-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| fancentro | nsfw | public-profile-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| loyalfans | nsfw | public-profile-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| manyvids | nsfw | public-profile-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| clips4sale | nsfw | public-profile-crawl | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| lpsg | nsfw | public-forum-get | sxysindy | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
