# Audit complementaire 1.7.1

Date : 2026-07-26

## Perimetre

Cette passe complete l'audit 1.7.0 sans relancer inutilement les 97 sources. Le catalogue complet et ses 97 adaptateurs avaient deja ete testes le meme jour. Seul le transport Telegram, ajoute depuis, a fait l'objet d'un nouveau test live cible.

## Corrige

- Les donnees Vercel ne sont plus partagees entre les visiteurs : historique, collection, profils, queue, veilles et cache serveur utilisent un magasin distinct par cookie navigateur `HttpOnly`.
- Les fichiers temporaires de session sont bornes a 100 fichiers et 64 Mio, puis expires selon `MEDIAGATHERER_SESSION_TTL_DAYS`.
- La persistance Upstash Redis REST utilise une cle et un TTL distincts par session. Une hydratation distante en echec peut etre retentee.
- `APP_WRITE_TOKEN` peut maintenant etre saisi dans Connexions. Le serveur cree un cookie d'autorisation `HttpOnly` de deux heures; le jeton est efface du formulaire et n'est jamais persiste.
- Telegram accepte uniquement un username public exact, borne le crawl a 40 messages et conserve images, videos, miniatures, compte et URLs de message comme preuves.
- La signature Authenticode de l'EXE est integree au workflow GitHub avant le checksum, mais seulement lorsqu'un PFX valide et son mot de passe sont fournis comme secrets.
- Les secrets locaux, PFX et fichiers de liaison Vercel restent exclus de Git.

## Verifications

- `npm run qa` : 84 tests sur 84 reussis, syntaxe serveur et frontend valide.
- `npm audit --omit=dev` : 0 vulnerabilite.
- Couverture Node instrumentee : 61,85 % des lignes sur l'ensemble charge; `remoteStore` 91,20 %, `storeScope` 98,75 % et Telegram 95,84 %.
- Audit live Telegram `durov` : HTTP 200, etat `operational`, 20 messages publics bornes, 1 photo pertinente, aucune miniature absente.
- EXE Windows local : 132 301 774 octets, en-tete `MZ`, demarrage autonome et `/api/health` en version 1.7.1.
- SHA-256 de l'EXE local non signe : `5b5143c39522b15edd230b9cc92aef47c2e4e2871c52494ded604ab46feaa81d`.
- Registre runtime : 97 sources, 52 NSFW et 97 adaptateurs, aucun identifiant de source duplique ou sans contrat.

## Limites externes

- Le code Upstash est pret, mais l'installation Vercel reste bloquee jusqu'a l'acceptation des conditions Marketplace par le proprietaire du compte. Sans Redis, les donnees Vercel sont isolees mais temporaires.
- Google, Brave, Flickr, YouTube et les autres fournisseurs optionnels exigent les cles personnelles officielles du proprietaire. Aucune cle publique ou partagee n'est injectee.
- La signature reelle exige un certificat de signature de code valide. Le binaire local reste non signe tant que les secrets GitHub correspondants ne sont pas fournis.
- La QA visuelle par capture desktop/mobile n'a pas pu etre renouvelee : aucun navigateur utilisateur n'etait disponible dans le runtime Codex. Les contrats DOM, le responsive CSS et les parcours API sont testes, mais ne remplacent pas une validation visuelle.

## Conclusion

Le concept est coherent et fonctionnel sur les surfaces controlables dans le depot : Media Finder et Person Finder restent separes, les resultats sont progressifs, les sources adultes exigent une confirmation 18+, les preuves et alias restent verifiables, et les donnees publiques ne sont pas contournees. Les actions restantes sont des activations proprietaire, pas des fonctions manquantes dans le code.
