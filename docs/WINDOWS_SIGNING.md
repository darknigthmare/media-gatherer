# Signature Windows optionnelle

Ce mecanisme signe un executable MediaGatherer deja construit avec un certificat
PFX existant. Il ne cree, ne genere et n'exporte aucun certificat.

## Prerequis

- Windows et PowerShell 5.1 ou PowerShell 7.
- `signtool.exe` fourni par le Windows SDK, accessible dans `PATH`.
- Un certificat de signature de code valide au format PFX.
- `dist/MediaGatherer.exe` produit par `npm run build:exe`.

Si SignTool n'est pas dans `PATH`, definir `SIGNTOOL_PATH` avec son chemin
complet.

## Utilisation interactive recommandee

Le mot de passe est saisi comme `SecureString` et n'apparait pas dans la
commande :

```powershell
$password = Read-Host -Prompt 'Mot de passe du PFX' -AsSecureString
.\scripts\sign-windows.ps1 `
    -ExecutablePath '.\dist\MediaGatherer.exe' `
    -PfxPath 'C:\certificats\code-signing.pfx' `
    -PfxPassword $password
```

## Utilisation par variables d'environnement

Pour une CI, injecter les valeurs depuis le gestionnaire de secrets de la
plateforme :

```powershell
$env:MEDIA_GATHERER_SIGNING_PFX = 'C:\certificats\code-signing.pfx'
$env:MEDIA_GATHERER_SIGNING_PASSWORD = '<secret injecte par la CI>'
pwsh -File .\scripts\sign-windows.ps1 `
    -ExecutablePath '.\dist\MediaGatherer.exe'
```

Ne pas enregistrer le PFX ou son mot de passe dans Git, un script, un log ou un
artefact public. Le script n'imprime jamais le mot de passe.

## Fonctionnement

Le script :

1. exige un executable, un PFX et un mot de passe non vide ;
2. refuse une URL d'horodatage autre que HTTPS ;
3. signe avec un digest SHA-256 et un horodatage RFC 3161 SHA-256 ;
4. controle explicitement le code de sortie de `signtool sign` ;
5. execute `signtool verify /pa /all` et echoue si la verification est invalide.

L'URL d'horodatage par defaut est
`https://timestamp.digicert.com`. Elle peut etre remplacee avec
`-TimestampUrl`, a condition de rester en HTTPS.

Toute erreur de fichier, certificat, mot de passe, horodatage, signature ou
verification arrete le script avec un code d'echec. Aucun certificat de test ou
auto-signe n'est cree en fallback.
