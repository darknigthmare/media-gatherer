# Audit live des sources MediaGatherer

Date: 2026-07-15T06:24:27.862Z

Base testee: `http://127.0.0.1:3016`

Sources: 2; operational: 1; degradees: 0; faux positifs: 0; vides: 0; configuration requise: 1; bloquees: 0; limitees: 0; erreurs: 0.

| Source | Categorie | Adaptateur | Requete | Etat | HTTP | Photos | Videos | Echantillons pertinents | Miniatures absentes | Pages | Raison |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| gelbooru | nsfw | gelbooru-dapi | hatsune miku | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| danbooru | nsfw | danbooru-api | hatsune miku | operational | 200 | 5 | 0 | 5/5 | 0 | 0/0 | Danbooru API publique |
