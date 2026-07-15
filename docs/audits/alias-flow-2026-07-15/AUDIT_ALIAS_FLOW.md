# Audit UX - Alias et identite

Date : 2026-07-15

Surface testee : `https://media-gatherer.vercel.app`

Parcours : Media Finder -> recherche Wikidata -> alias trouves -> clic sur un alias -> Person Finder.

## Verdict

L extraction et l affichage des alias fonctionnent. Le clic parait inactif parce qu il remplace seulement la valeur du champ de recherche situe en haut de page. Il ne lance aucune recherche, ne fait pas defiler la page, ne confirme pas l action et laisse les anciens resultats affiches.

## Preuves

1. `01-start.png` : point de depart de Media Finder.
2. `02-aliases-found.png` : quatre alias publics trouves pour Taylor Swift via Wikidata.
3. `03-alias-click-no-feedback.png` : apres le clic sur Nils Sjoberg, seul le focus du bouton change.
4. `05-hidden-query-replacement.png` : le champ en haut contient Nils Sjoberg, mais les resultats restent ceux de Taylor Swift.
5. `04-person-finder-alias-entry.png` : Person Finder permet de saisir et resoudre des alias, mais Media Finder ne peut pas lui transmettre un candidat.
6. `06-alias-action-panel.png` : premier rendu du panneau d actions apres correction.
7. `07-person-alias-review.png` : candidat confirme dans le tiroir Person Finder avec sa confiance et sa preuve.
8. `08-alias-layout-final.png` : mise en page finale elargie, sans colonne vide et avec actions visibles.

## Problemes prioritaires

### P1 - Clic trompeur

`public/js/app.js` remplit `searchInput.value` et ajoute une ligne de log. Il ne soumet pas le formulaire. L utilisateur reste loin du champ modifie et ne voit aucun changement utile.

### P1 - Resultats et requete deviennent incoherents

Apres le clic, la requete affichee devient l alias alors que les medias et statistiques correspondent toujours a la recherche precedente.

### P1 - Aucun pont vers Person Finder

Un alias trouve dans Media Finder ne peut pas etre ajoute a une fiche personne existante, ni servir a en creer une.

### P1 - Provenance perdue dans la fiche personne

Les candidats de Media Finder possedent confiance, sources et preuves. Person Finder les transforme ensuite en simples chaines dans `aliases` et `usernames`. La fiche ne conserve donc pas pourquoi un alias a ete accepte.

### P2 - Pas de cycle de validation

Il manque les statuts `a_verifier`, `confirme`, `rejete` et `fusionne`, ainsi que les actions annuler/supprimer. Un faux alias ne peut pas etre exclu durablement.

### P2 - Preuves invisibles sur mobile et au clavier

La provenance est placee dans l attribut `title`. Elle est difficile a decouvrir au tactile et n est pas presentee dans une vue accessible.

### P2 - Couverture de tests incomplete

Les tests couvrent l extraction et la normalisation des alias, mais pas le clic, le lancement d une recherche, l association a Person Finder ou le rejet d un candidat.

## Mise a jour recommandee

### Interaction d un alias

- Un clic selectionne l alias et ouvre un petit panneau de details.
- Un bouton avec icone Recherche lance immediatement une nouvelle recherche avec les sources actuelles.
- Un bouton Ajouter a la personne propose la fiche Person Finder cible.
- Un bouton Rejeter cree une exclusion persistante pour cette identite.
- Un bouton Preuves montre confiance, sources, URLs et date de decouverte.

Le simple remplacement silencieux du champ doit etre retire. Si l action Recherche est choisie, l interface doit afficher un etat de chargement puis remonter vers le journal/resultat actif.

### Mode de recherche

- `Remplacer` : nouvelle recherche uniquement sur l alias.
- `Ajouter` : conserve les resultats existants et fusionne les medias trouves sous la meme identite.
- `Tous les alias` : file d attente dedupliquee pour le nom canonique et tous les alias confirmes.

### Modele de donnees

Ajouter des candidats d alias structures :

```json
{
  "value": "Nils Sjoberg",
  "normalizedValue": "nils sjoberg",
  "kind": "display_name",
  "status": "to_review",
  "confidence": 90,
  "sources": ["wikidata"],
  "evidence": ["https://www.wikidata.org/wiki/Q26876"],
  "discoveredAt": "2026-07-15T00:00:00.000Z"
}
```

## Criteres d acceptation

1. Chaque clic produit un retour visible immediat.
2. Rechercher lance effectivement le formulaire et met les resultats en coherence avec la requete.
3. Ajouter a Person Finder conserve confiance, sources et preuves.
4. Rejeter empeche le meme candidat de revenir sans nouvel element probant.
5. Toutes les actions sont accessibles au clavier et au tactile, sans dependre de `title`.
6. Des tests DOM couvrent clic, recherche, ajout, rejet et restauration de l etat.

## Correction integree en 1.6.1

- Le clic selectionne maintenant l alias et ouvre un panneau d actions visible sans modifier silencieusement la requete.
- `Rechercher` soumet le formulaire; `Ajouter aux resultats` conserve la recherche canonique et deduplique les nouveaux medias.
- Le transfert vers Person Finder conserve le type, la confiance, les sources, les preuves, la requete d origine et le statut `to_review`.
- Le tiroir `Alias a valider` permet de rechercher, confirmer ou rejeter chaque candidat depuis la fiche personne.
- Les alias confirmes affiches dans la fiche personne sont des commandes de recherche, plus des etiquettes inertes.
- Un rejet est memorise localement et cote serveur; la resolution d identite respecte ensuite ce choix.
- Les contrats API et DOM couvrent la persistance, la confirmation, le rejet, la suppression et les actions de recherche.
- Verification navigateur reelle : recherche Wikidata, selection, fusion aux resultats, transfert Person Finder, confirmation, rejet et relance depuis la fiche; aucune erreur console finale.
