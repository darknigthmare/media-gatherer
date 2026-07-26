# Audit MediaGatherer 1.8.0 - 26 juillet 2026

## Perimetre

Cette passe couvre les mises a jour prioritaires 1, 2, 3, 5, 6 et 7 :

- recherche Person Finder equitable et adaptee a chaque source ;
- contrats, canaris et surveillance des 97 sources existantes ;
- couverture reelle par identite et source ;
- etat de qualite media explicite et verification progressive ;
- veille automatique locale avec frequence, baseline et nouveaux resultats ;
- extraction des registres, services et routes prioritaires hors du serveur principal.

Le stockage durable Vercel/Upstash n'a volontairement pas ete active, conformement
a la demande. Aucun nouveau site n'a ete ajoute pendant cette passe : la priorite
est la fiabilite des 97 sources deja declarees.

## Resultats verifies

| Controle | Resultat |
| --- | --- |
| Tests automatises | 95/95 |
| Audit npm production | 0 vulnerabilite |
| Sources declarees | 97 uniques |
| Sources NSFW | 52 |
| Adaptateurs exposes | 97 |
| Canaris publics | 97 |
| Adaptateurs de crawl | 53 |
| Erreurs de contrat | 0 |
| Avertissements de contrat | 0 |

Le controle reseau cible a interroge Bing, Wikimedia, Telegram, Wayback, Erome,
Eporner, Wikidata et Coomer avec leur propre canari public. Le resultat est de
7 sources operationnelles, 1 degradee et aucune source vide ou en erreur.
Wayback est la source degradee : elle a repondu en 7,4 secondes avec 10 medias.

Rapports :

- `docs/audits/2026-07-26/source-canaries-v180-targeted.json`
- `docs/audits/2026-07-26/source-canaries-v180-targeted.md`

## Person Finder

Le planificateur distingue le nom principal, les alias, les usernames et les
comptes confirmes. Il choisit la requete attendue par chaque adaptateur :

- username brut pour Telegram ;
- username exact pour GitHub et Coomer ;
- URL ou domaine confirme pour les archives ;
- nom exact pour les sources de metadonnees ;
- requetes generiques uniquement pour les moteurs compatibles.

Le budget est reparti entre les identites au lieu d'etre consomme par le premier
alias. Chaque couple identite/source affiche maintenant son etat reel :
planifie, interroge, ignore avec raison, ou en erreur. Les executions sont
conservees dans un historique borne a 100 recherches.

Un test reseau Person Finder sur Wikidata a cree un media lie, enregistre une
couverture interrogee avec un resultat et ajoute l'evenement
`search_completed` a la timeline.

## Medias et veille

La qualite ne presente plus une miniature comme un original. Les etats exposes
sont :

- original confirme ;
- meilleure variante declaree ;
- miniature uniquement ;
- qualite non verifiee.

Les dimensions intrinseques sont mesurees progressivement lorsque l'image est
chargee dans la galerie ou la visionneuse.

La veille locale est maintenant executable sans modifier la recherche active.
Elle accepte une frequence minimale de 15 minutes, une selection de sources et
de types, une baseline bornee, puis calcule les nouveaux medias. Un test reseau
sur Wikimedia a collecte 27 photos, enregistre la baseline et termine sans
erreur.

## Architecture et exploitation

Les elements suivants ont ete sortis du serveur principal :

- `src/sources/sourceRegistry.js`
- `src/sources/sourceCanaries.js`
- `src/services/personQueryPlanner.service.js`
- `src/services/personSearch.service.js`
- `src/services/mediaQuality.service.js`
- `src/services/monitor.service.js`
- `src/routes/monitor.routes.js`

Le workflow `source-contract-monitor.yml` controle chaque semaine les contrats
et canaris hors ligne. Le crawl reseau complet reste manuel afin d'eviter des
requetes agressives et des bannissements. Le script de comparaison d'audits
signale les regressions entre deux instantanes.

## Binaire Windows

`dist/MediaGatherer.exe` a ete construit et lance sur un port isole.

- taille : 132 468 693 octets (126,33 Mio) ;
- en-tete Windows : `MZ` ;
- SHA-256 : `13140850C85AFDA73E08B2BE38D79803EC744BA02F8C0C02D0FDC6A97217C3C3` ;
- controle runtime : API v1.8.0, 97 sources, 52 NSFW, 97 adaptateurs et 97 canaris.

Le binaire local n'est pas signe numeriquement. La signature Authenticode reste
conditionnee a la presence d'un vrai certificat PFX et de son mot de passe dans
les secrets GitHub.

## Limites externes connues

- Les sites peuvent changer leur HTML, limiter le debit, imposer un captcha ou
  ne pas exposer directement les medias publics.
- Un canari d'identite comme Coomer peut etre operationnel sans fournir de
  media : le profil public exact et ses metadonnees constituent alors le
  resultat attendu.
- Wayback reste sensible a la latence et a la disponibilite de l'Internet
  Archive.
- Les contenus prives, comptes fermes, paywalls et protections d'acces ne sont
  pas contournes.
- Aucun controle visuel frais par capture de navigateur n'a ete effectue pendant
  cette passe, faute de navigateur utilisateur attache. Les contrats DOM,
  interactions principales et regles responsive sont couverts par les tests.
