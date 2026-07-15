# Audit live des sources MediaGatherer

Date: 2026-07-15T06:27:17.006Z

Base testee: `http://127.0.0.1:3016`

Sources: 9; operational: 1; degradees: 0; faux positifs: 0; vides: 6; configuration requise: 1; bloquees: 1; limitees: 0; erreurs: 0.

| Source | Categorie | Adaptateur | Requete | Etat | HTTP | Photos | Videos | Echantillons pertinents | Miniatures absentes | Pages | Raison |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| fanvue | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| chaturbate | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| stripchat | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| camsoda | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| livejasmin | nsfw | public-profile-crawl | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_pages |
| indexxx | nsfw | public-metadata-crawl | mia khalifa | access_blocked | 200 | 0 | 0 | 0/0 | 0 | 0/0 | access_blocked |
| boobpedia | nsfw | public-metadata-crawl | mia khalifa | operational | 200 | 3 | 0 | 3/3 | 0 | 4/4 | 4 pages correspondantes; 4 ouvertes; www.boobpedia.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200; profils publics uniquement |
| gelbooru | nsfw | gelbooru-dapi | mia khalifa | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| danbooru | nsfw | danbooru-api | mia khalifa | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_matching_public_media |
