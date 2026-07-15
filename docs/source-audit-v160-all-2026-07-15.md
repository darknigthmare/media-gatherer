# Audit live des sources MediaGatherer

Date: 2026-07-15T06:33:57.725Z

Base testee: `http://127.0.0.1:3016`

Sources: 96; operational: 29; degradees: 3; faux positifs: 0; vides: 44; configuration requise: 12; bloquees: 6; limitees: 2; erreurs: 0.

| Source | Categorie | Adaptateur | Requete | Etat | HTTP | Photos | Videos | Echantillons pertinents | Miniatures absentes | Pages | Raison |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| duckduckgo | normal | duckduckgo-images | NASA | degraded | 200 | 5 | 5 | 8/10 | 2 | 3/3 | Endpoint public DuckDuckGo Images; 3 pages web, 3 ouvertes |
| bing | normal | bing-images | NASA | operational | 200 | 1 | 0 | 1/1 | 0 | 0/0 | Bing Images HTTP 200 |
| google | normal | google-cse | NASA | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| brave | normal | brave-images-api | NASA | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| flickr | normal | flickr-public-feed | NASA | operational | 200 | 20 | 0 | 10/10 | 0 | 0/0 | Flux public Flickr |
| wikimedia | normal | wikimedia-api | NASA | operational | 200 | 5 | 0 | 3/5 | 0 | 0/0 | API Wikimedia Commons |
| youtube | normal | youtube-public | NASA | operational | 200 | 0 | 5 | 5/5 | 0 | 0/0 | Page publique YouTube HTTP 200 |
| reddit | social | reddit-json | NASA | access_blocked | 200 | 0 | 0 | 0/0 | 0 | 0/0 | access_blocked |
| telegram | social | public-profile-crawl | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 1/1 | no_public_media_extracted |
| instagram | social | public-profile-crawl | Douglas Adams | operational | 200 | 4 | 0 | 4/4 | 0 | 6/6 | scan public; www.instagram.com: HTTP 200; duckduckgo.com: HTTP 200; www.bing.com: HTTP 200 |
| facebook | social | public-search-crawl | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| tiktok | social | public-search-crawl | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| x | social | public-search-crawl | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| pinterest | social | public-search-crawl | NASA | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| snapchat | social | public-profile-crawl | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| threads | social | public-profile-crawl | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| wayback | normal | wayback-cdx | NASA | rate_limited | 200 | 0 | 0 | 0/0 | 0 | 0/4 | rate_limited |
| vimeo | normal | public-search-crawl | NASA | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| dailymotion | normal | dailymotion-api | NASA | operational | 200 | 0 | 5 | 5/5 | 0 | 0/0 | API publique Dailymotion |
| freeones | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| freeonesforum | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| babesource | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| erome | nsfw | source-crawl | mia khalifa | operational | 200 | 5 | 5 | 10/10 | 0 | 8/8 | 8 pages correspondantes; 8 ouvertes; fr.erome.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| redgifs | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| imagebam | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| imagefap | nsfw | source-crawl | mia khalifa | operational | 200 | 5 | 0 | 5/5 | 0 | 8/8 | 8 pages correspondantes; 8 ouvertes; www.imagefap.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| pornpics | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| babepedia | nsfw | source-crawl | mia khalifa | access_blocked | 200 | 0 | 0 | 0/0 | 0 | 0/0 | access_blocked |
| camwhores | nsfw | source-crawl | mia khalifa | access_blocked | 200 | 0 | 0 | 0/0 | 0 | 0/0 | access_blocked |
| pornzog | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| onlyfans | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| fansly | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| mym | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| xhamster | nsfw | source-crawl | mia khalifa | operational | 200 | 0 | 5 | 5/5 | 0 | 6/6 | 6 pages correspondantes; 6 ouvertes; xhamster.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| xvideos | nsfw | source-crawl | mia khalifa | operational | 200 | 0 | 5 | 5/5 | 0 | 6/6 | 6 pages correspondantes; 6 ouvertes; www.xvideos.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| spankbang | nsfw | source-crawl | mia khalifa | operational | 200 | 0 | 5 | 5/5 | 0 | 6/6 | 6 pages correspondantes; 6 ouvertes; spankbang.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| pornhub | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| youporn | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| tube8 | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| tnaflix | nsfw | source-crawl | mia khalifa | operational | 200 | 0 | 5 | 5/5 | 0 | 6/6 | 6 pages correspondantes; 6 ouvertes; www.tnaflix.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| motherless | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| eporner | nsfw | eporner-api-v2 | mia khalifa | operational | 200 | 0 | 5 | 5/5 | 0 | 0/5 | 5 videos via API publique Eporner (1340 correspondances annoncees) |
| xnxx | nsfw | source-crawl | mia khalifa | operational | 200 | 0 | 5 | 5/5 | 0 | 5/5 | 5 pages correspondantes; 5 ouvertes; www.xnxx.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| hqporner | nsfw | source-crawl | mia khalifa | operational | 200 | 0 | 4 | 4/4 | 0 | 4/4 | 4 pages correspondantes; 4 ouvertes; hqporner.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| nuvid | nsfw | source-crawl | mia khalifa | operational | 200 | 0 | 5 | 5/5 | 0 | 5/5 | 5 pages correspondantes; 5 ouvertes; www.nuvid.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| drtuber | nsfw | source-crawl | mia khalifa | operational | 200 | 0 | 5 | 5/5 | 0 | 5/5 | 5 pages correspondantes; 5 ouvertes; www.drtuber.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| pornone | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| youjizz | nsfw | source-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| phunforum | nsfw | public-forum-get | mia khalifa | operational | 200 | 5 | 0 | 5/5 | 0 | 4/4 | 4 pages correspondantes; 4 ouvertes; forum.phun.org: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| planetsuzy | nsfw | public-forum-form | mia khalifa | degraded | 200 | 5 | 5 | 10/10 | 5 | 4/4 | 4 pages correspondantes; 4 ouvertes; www.planetsuzy.org: formulaire public HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| bellazon | nsfw | public-forum-get | mia khalifa | operational | 200 | 5 | 0 | 5/5 | 0 | 4/4 | 4 pages correspondantes; 4 ouvertes; www.bellazon.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| wikidata | identity | wikidata-api | Douglas Adams | operational | 200 | 1 | 0 | 1/1 | 0 | 0/0 | Entite retenue: Douglas Adams (Q42), 8 candidates analyses |
| tmdb | identity | tmdb-api | Douglas Adams | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| openverse | normal | openverse-api | NASA | operational | 200 | 5 | 0 | 5/5 | 0 | 0/0 | API publique Openverse; 240 correspondances annoncees |
| internetarchive | normal | archive-org-api | NASA | operational | 200 | 5 | 0 | 4/5 | 0 | 0/0 | 6 collections publiques analysees |
| arquivo | normal | arquivo-api | NASA | operational | 200 | 5 | 0 | 4/5 | 0 | 0/0 | Recherche images archivees Arquivo.pt |
| imgur | normal | imgur-api | NASA | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| peertube | normal | peertube-api | NASA | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_media |
| commoncrawl | normal | commoncrawl-warc | NASA | degraded | 200 | 5 | 5 | 9/10 | 2 | 2/4 | 2 captures trouvees, 2 WARC ouvertes dans CC-MAIN-2026-25; 1 essais ignores |
| searxng | normal | searxng-api | NASA | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_configuration |
| odysee | normal | odysee-claims-api | NASA | operational | 200 | 0 | 5 | 5/5 | 0 | 0/0 | Index public de claims Odysee/LBRY |
| gdelt | normal | gdelt-doc-api | NASA | rate_limited | 200 | 0 | 0 | 0/0 | 0 | 0/0 | rate_limited |
| podcastindex | normal | podcast-index-api | NASA | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| pexels | normal | pexels-api | NASA | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| giphy | normal | giphy-api | NASA | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| bluesky | social | bluesky-api | Douglas Adams | operational | 200 | 0 | 1 | 1/1 | 0 | 0/0 | API publique Bluesky |
| mastodon | social | mastodon-api | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_media |
| lemmy | social | lemmy-api | Douglas Adams | operational | 200 | 3 | 0 | 3/3 | 0 | 0/0 | API publique lemmy.world |
| pixelfed | social | pixelfed-api | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| tumblr | social | tumblr-api | Douglas Adams | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| twitch | social | twitch-api | Douglas Adams | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| github | identity | github-users-api | Douglas Adams | operational | 200 | 4 | 0 | 4/4 | 0 | 0/0 | API GitHub publique non authentifiee |
| musicbrainz | identity | musicbrainz-api | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | identity_metadata_only |
| linktree | identity | public-profile-crawl | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| beacons | identity | public-profile-crawl | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| allmylinks | identity | public-profile-crawl | Douglas Adams | access_blocked | 200 | 0 | 0 | 0/0 | 0 | 0/0 | access_blocked |
| carrd | identity | public-profile-crawl | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| stashdb | nsfw | stashdb-graphql | mia khalifa | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| iafd | nsfw | public-metadata-crawl | mia khalifa | operational | 200 | 1 | 0 | 1/1 | 0 | 1/1 | 1 pages correspondantes; 1 ouvertes; www.iafd.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200; profils publics uniquement |
| adultdatabase | nsfw | public-metadata-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| theporndb | nsfw | public-metadata-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| fancentro | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| loyalfans | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| manyvids | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| clips4sale | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| lpsg | nsfw | public-forum-get | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| adultdvdtalk | nsfw | public-forum-get | mia khalifa | access_blocked | 200 | 0 | 0 | 0/0 | 0 | 0/0 | access_blocked |
| fanvue | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| chaturbate | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| stripchat | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| camsoda | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| livejasmin | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| indexxx | nsfw | public-metadata-crawl | mia khalifa | access_blocked | 200 | 0 | 0 | 0/0 | 0 | 0/0 | access_blocked |
| boobpedia | nsfw | public-metadata-crawl | mia khalifa | operational | 200 | 3 | 0 | 3/3 | 0 | 4/4 | 4 pages correspondantes; 4 ouvertes; www.boobpedia.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200; profils publics uniquement |
| gelbooru | nsfw | gelbooru-dapi | mia khalifa | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| danbooru | nsfw | danbooru-api | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_media |
