# Deploiement

## Local

```powershell
npm install
npm start
```

## Build Windows exe

```powershell
npm install
npm run build:exe
```

Le fichier attendu est `dist/MediaGatherer.exe`. Il lance le serveur local Express et sert l'interface dans `public/`.

## Vercel

```powershell
npx vercel --prod
```

Sur Vercel, le stockage local est temporaire (`/tmp`) car les fonctions serverless ne gardent pas les fichiers entre les redeploiements. Pour une persistance production, il faudra brancher une base externe.

## GitHub

Le depot doit etre initialise dans le dossier du projet, pas dans le profil Windows. Verifier avant push :

```powershell
git rev-parse --show-toplevel
git status --short --branch
```
