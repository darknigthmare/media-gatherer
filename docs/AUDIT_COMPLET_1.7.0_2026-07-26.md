# Audit complet MediaGatherer 1.7.0

Date: 26 juillet 2026

## Verdict

Le concept principal est coherent et testable de bout en bout:

- Media Finder recherche des photos et videos publiques sur plusieurs sources et affiche les resultats progressivement.
- Person Finder separe les profils, alias confirmes, alias candidats, comptes publics, medias lies, preuves, validations, timeline, graphe et rapport.
- Les sources NSFW exigent une confirmation adulte et sont interdites lorsqu'une annee de naissance rend la majorite impossible a confirmer.
- Les pages de comptes publics validees peuvent fournir tous leurs medias publics sans exiger le nom dans chaque titre.
- Wayback applique la pertinence lors de la decouverte du domaine, puis ne filtre plus les medias archives par nom.

La QA automatisee passe avec 56 tests. L'audit npm ne remonte aucune vulnerabilite connue.

## Audit live des sources

Le controle complet du 26 juillet est conserve dans
[`audits/2026-07-26/sources-live-complete.md`](audits/2026-07-26/sources-live-complete.md).

- 97 sources declarees et 97 contrats d'adaptateur.
- 31 operationnelles.
- 2 degradees.
- 45 vides pour la requete de controle.
- 12 avec configuration requise.
- 6 bloquees par la source distante.
- 1 limitee par le debit.
- 0 faux positif sur les echantillons controles.
- 0 erreur interne.

Un zero ne signifie donc plus automatiquement que l'adaptateur est casse. Il peut
signifier: aucun resultat public pertinent, cle API absente, blocage robot,
limitation, JavaScript obligatoire ou restriction regionale.

## Source Coomer

`site1.coomer.com.co` est integre comme source d'identite NSFW en metadonnees
publiques uniquement:

- recherche par username exact;
- endpoint de petit profil, sans aspiration de l'index global;
- compte public et alias candidats;
- aucun crawl de publication;
- aucune extraction ou mise en proxy de medias issus d'un contenu payant divulgue;
- aucun identifiant, contournement de connexion ou session partagee.

Le controle exact `amouranth` est operationnel et conserve dans
[`audits/2026-07-26/coomer-public-metadata.md`](audits/2026-07-26/coomer-public-metadata.md).

## Corrections realisees

- Annulation et isolation des recherches concurrentes.
- Fusion non destructive du fallback local Person Finder.
- Validation stricte des creations et editions de profils.
- Blocage des profils Person Finder non publics ou sans Safe mode.
- Blocage NSFW des ages mineurs ou ambigus.
- Alias et comptes decouverts conserves comme candidats avant confirmation.
- CRUD valide et deduplique des comptes publics.
- Regles de validation typees avec actions review et boost fonctionnelles.
- Priorite de la regle la plus recente.
- Plan Person Finder coherent avec la profondeur et les sources executees.
- Conservation des resultats partiels et erreurs par requete.
- Galerie Person Finder filtree, scrollable, avec statuts, sources et preuves.
- Timeline exacte avec evenements de decouverte et validation distincts.
- Export de la vraie timeline au lieu des liens medias bruts.
- Graphe relationnel et rapport public sans secrets ni donnees privees.
- Queue batch cooperative avec progression, pause, reprise et annulation.
- Identifiants API isoles par session navigateur, expires et bornes.
- Store local, diagnostics et cache bornes.
- Proxy reduit a 32 Mio et types binaires generiques refuses sans extension media.
- Miniatures Imgur video et selection Danbooru video corrigees.
- Score explicite zero conserve et diagnostic de pertinence des tests de sources renforce.

## Limites residuelles

- Les adaptateurs HTML dependent de pages distantes qui peuvent changer sans preavis.
- Plusieurs sources sociales exigent JavaScript ou une API officielle; aucun resultat
  ne doit etre simule lorsqu'elles bloquent le serveur.
- Telegram MTProto n'est pas integre. Il exige une application Telegram et une
  session locale explicite, uniquement pour les comptes et canaux autorises.
- Le stockage Vercel est un mode de demonstration partage tant qu'un token
  d'ecriture et un stockage durable correctement isole ne sont pas configures.
- Le store Upstash optionnel replique encore un document complet; une base
  transactionnelle par utilisateur serait preferable pour un service multi-utilisateur.
- L'EXE est autonome mais non signe. SmartScreen peut donc afficher un avertissement.
- La capture visuelle automatique desktop/mobile n'etait pas disponible dans le
  navigateur Codex de cette passe. Les contrats DOM, le responsive CSS et les smokes
  HTTP sont verifies, mais une revue visuelle manuelle reste requise avant de figer
  une nouvelle direction graphique.

## Definition de termine

Pour chaque version:

1. `npm run qa`
2. `npm audit`
3. audit live cible des adaptateurs modifies
4. smoke HTTP local
5. build et smoke de `dist/MediaGatherer.exe`
6. commit et push GitHub
7. release GitHub avec SHA-256
8. deploiement Vercel production
9. verification live de la page, de `/api/health`, `/api/sources` et `/api/sources/adapters`
