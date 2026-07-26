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
Get-FileHash -Algorithm SHA256 dist/MediaGatherer.exe
gh release create v1.7.1 dist/MediaGatherer.exe dist/MediaGatherer.exe.sha256 --title "MediaGatherer 1.7.1" --generate-notes
```

Pour signer le binaire avec un certificat de signature de code existant :

```powershell
npm run sign:exe
```

Voir [WINDOWS_SIGNING.md](WINDOWS_SIGNING.md). Le workflow GitHub signe automatiquement avant le checksum lorsque les secrets `WINDOWS_CERTIFICATE_BASE64` et `WINDOWS_CERTIFICATE_PASSWORD` sont tous les deux configures.

## Vercel

Le projet est lie par le dossier `.vercel/` local :

```powershell
npx vercel --prod --yes
```

Verification minimale apres publication :

```powershell
Invoke-RestMethod https://VOTRE-DOMAINE/api/health
```

Les fonctions Vercel ont un stockage fichier temporaire dans `/tmp`. Chaque navigateur utilise deja un espace distinct grace a son cookie `HttpOnly`; il reste volatile sans Redis.

Installer Upstash Redis depuis le Marketplace Vercel :

```powershell
npx vercel integration add upstash/upstash-kv --scope darknigthmares-projects
npx vercel env pull .env.local --environment=production --yes
```

L'acceptation des conditions Marketplace Upstash doit etre effectuee par le proprietaire du compte Vercel. L'integration injecte normalement les variables REST. Pour une ressource externe existante, ajouter manuellement :

```text
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...
MEDIAGATHERER_REMOTE_KEY=mediagatherer:store
MEDIAGATHERER_SESSION_TTL_DAYS=30
```

Chaque session Redis utilise une cle separee et expire apres la duree d'inactivite configuree. Sans ces variables, la recherche reste fonctionnelle et isolee, mais `/api/health` signale explicitement le stockage volatil.

Pour proteger les modifications sur une instance publique, ajouter aussi `APP_WRITE_TOKEN` dans les variables Vercel. Le jeton est saisi dans l'onglet Connexions, transforme en cookie de session `HttpOnly` valable deux heures et n'est jamais stocke dans le navigateur ni dans les donnees de l'application.

## GitHub

```powershell
git status --short --branch
git add .
git commit -m "Expand identity and public source adapters"
git push origin master
```

Le workflow `.github/workflows/ci.yml` execute `npm ci` puis `npm run qa` sur chaque push et pull request.
