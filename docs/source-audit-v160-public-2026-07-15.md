# Audit live des sources MediaGatherer

Date: 2026-07-15T06:26:33.419Z

Base testee: `http://127.0.0.1:3016`

Sources: 11; operational: 3; degradees: 1; faux positifs: 0; vides: 2; configuration requise: 4; bloquees: 0; limitees: 1; erreurs: 0.

| Source | Categorie | Adaptateur | Requete | Etat | HTTP | Photos | Videos | Echantillons pertinents | Miniatures absentes | Pages | Raison |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| commoncrawl | normal | commoncrawl-warc | NASA | degraded | 200 | 5 | 5 | 9/10 | 2 | 2/4 | 2 captures trouvees, 2 WARC ouvertes dans CC-MAIN-2026-25; 1 essais ignores |
| searxng | normal | searxng-api | NASA | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_configuration |
| odysee | normal | odysee-claims-api | NASA | operational | 200 | 0 | 5 | 5/5 | 0 | 0/0 | Index public de claims Odysee/LBRY |
| gdelt | normal | gdelt-doc-api | NASA | rate_limited | 200 | 0 | 0 | 0/0 | 0 | 0/0 | rate_limited |
| podcastindex | normal | podcast-index-api | NASA | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| pexels | normal | pexels-api | NASA | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| giphy | normal | giphy-api | NASA | configuration_required | 200 | 0 | 0 | 0/0 | 0 | 0/0 | missing_credentials |
| lemmy | social | lemmy-api | Douglas Adams | operational | 200 | 3 | 0 | 3/3 | 0 | 0/0 | API publique lemmy.world |
| pixelfed | social | pixelfed-api | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | no_public_media_extracted |
| github | identity | github-users-api | Douglas Adams | operational | 200 | 4 | 0 | 4/4 | 0 | 0/0 | API GitHub publique non authentifiee |
| musicbrainz | identity | musicbrainz-api | Douglas Adams | empty | 200 | 0 | 0 | 0/0 | 0 | 0/0 | identity_metadata_only |
