# Audit live des sources MediaGatherer

Date: 2026-07-26T16:11:08.802Z

Base testee: `http://127.0.0.1:3137`

Sources: 8; operational: 7; degradees: 1; faux positifs: 0; vides: 0; ignorees: 0; configuration requise: 0; bloquees: 0; limitees: 0; erreurs: 0.

| Source | Categorie | Adaptateur | Requete | Etat | HTTP | Photos | Videos | Echantillons pertinents | Miniatures absentes | Pages | Raison |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| bing | normal | bing-images | NASA | operational | 200 | 5 | 0 | 5/5 | 0 | 0/0 | Bing Images HTTP 200 |
| wikimedia | normal | wikimedia-api | NASA | operational | 200 | 3 | 0 | 3/3 | 0 | 0/0 | API Wikimedia Commons |
| telegram | social | telegram-web-public-bounded | durov | operational | 200 | 1 | 0 | 1/1 | 0 | 0/0 | 20 bounded public messages parsed |
| wayback | normal | wayback-cdx | nasa.gov | degraded | 200 | 5 | 5 | 10/10 | 5 | 1/4 | 5 domaine(s) via la recherche officielle Wayback; 1/4 domaine(s) interroge(s) via CDX |
| erome | nsfw | source-crawl | mia khalifa | operational | 200 | 5 | 5 | 10/10 | 0 | 8/8 | 8 pages correspondantes; 8 ouvertes; fr.erome.com: HTTP 200; duckduckgo.com: HTTP 202; www.bing.com: HTTP 200 |
| eporner | nsfw | eporner-api-v2 | mia khalifa | operational | 200 | 0 | 5 | 5/5 | 0 | 0/5 | 5 videos via API publique Eporner (1342 correspondances annoncees) |
| wikidata | identity | wikidata-api | Douglas Adams | operational | 200 | 1 | 0 | 1/1 | 0 | 0/0 | Entite retenue: Douglas Adams (Q42), 8 candidates analyses |
| coomer | nsfw | coomer-profile-api-v1 | amouranth | operational | 200 | 0 | 0 | 0/0 | 0 | 1/1 | identity_metadata_only |
