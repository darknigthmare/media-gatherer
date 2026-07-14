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
gh release create v1.5.1 dist/MediaGatherer.exe --title "MediaGatherer 1.5.1" --generate-notes
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

Les fonctions Vercel ont un stockage fichier temporaire dans `/tmp`. Pour rendre collection, historique, profils, cache, queue et veilles durables, configurer une base Upstash Redis REST puis ajouter :

```text
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...
MEDIAGATHERER_REMOTE_KEY=mediagatherer:store
```

Sans ces variables, la recherche reste fonctionnelle mais `/api/health` signale explicitement le stockage volatil.

## GitHub

```powershell
git status --short --branch
git add .
git commit -m "Expand identity and public source adapters"
git push origin master
```

Le workflow `.github/workflows/ci.yml` execute `npm ci` puis `npm run qa` sur chaque push et pull request.
