# Roadmap integree localement

Cette version compacte integre les passes utiles de la conversation dans le projet local existant :

- Backend Express reconstruit.
- Stockage JSON local pour historique, collection, cache, queue et Person Finder.
- Endpoints Media Finder conserves : recherche, Wayback, sources, connexions, politique de securite.
- Endpoints collection, exports, dashboard, cache et queue.
- Onglet Person Finder separe du Media Finder.
- Profils personnes, alias, usernames, comptes publics, mots positifs/exclus.
- Plan de recherche par profondeur.
- Recherche Person Finder avec association automatique en validation.
- Galerie personne, timeline, regles de validation et faux positifs.

Restent a faire pour une version lourde :

- Refactor complet en `src/routes` et `src/services`.
- SQLite natif a la place du JSON.
- Build Tauri reel avec sidecar Windows.
- Adaptateurs API officiels plus riches pour les sources qui en disposent.
