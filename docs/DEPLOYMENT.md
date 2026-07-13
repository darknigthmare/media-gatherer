# Deploiement

## Local

```powershell
npm ci
npm run qa
npm start
```

L'application est disponible sur `http://localhost:3000`.

## Executable Windows autonome

Le build utilise `@yao-pkg/pkg` avec Node.js 24 :

```powershell
npm ci
npm run build:exe
```

Verifier ensuite :

1. `dist/MediaGatherer.exe` commence par la signature `MZ`.
2. Le binaire demarre sans installation Node.
3. `http://127.0.0.1:3000/api/health` repond.
4. `dist/data/` est cree a cote du binaire, jamais dans le snapshot pkg.

`dist/` est ignore par Git. Publier l'EXE comme asset d'une release GitHub :

```powershell
gh release create v1.2.0 dist/MediaGatherer.exe --title "MediaGatherer 1.2.0" --generate-notes
```

## Vercel

Le projet est lie par le dossier `.vercel/` local :

```powershell
npx vercel --prod --yes
```

Verification minimale apres publication :

```powershell
Invoke-RestMethod https://VOTRE-DOMAINE/api/health
```

Les fonctions Vercel ont un stockage fichier temporaire dans `/tmp`. La recherche fonctionne, mais collection, historique, profils, cache, queue et veilles ne sont pas garantis entre les instances. Une base externe est necessaire pour une vraie persistance web.

## GitHub

```powershell
git status --short --branch
git add .
git commit -m "Harden Media Finder and complete application audit"
git push origin master
```

Le workflow `.github/workflows/ci.yml` execute `npm ci` puis `npm run qa` sur chaque push et pull request.
