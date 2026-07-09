# MediaGatherer

Application locale Node.js / Express pour rechercher des medias publics, organiser les resultats et separer deux usages :

- Media Finder : recherche generale de photos, videos, archives et sources publiques.
- Person Finder : recherche centree sur une personne publique ou consentie, avec alias, comptes publics, score, validation et timeline.

## Lancement

```powershell
npm install
npm start
```

Puis ouvrir `http://localhost:3000`.

## Verification

```powershell
npm run check
```

## Donnees locales

Les donnees runtime sont stockees dans `data/mediagatherer.store.json` et ignorees par Git.

## Garde-fous

Person Finder est limite aux contenus publics ou fournis avec consentement. L'application ne doit pas contourner de login, paywall, compte prive, ni collecter adresse privee, telephone prive ou localisation temps reel.
