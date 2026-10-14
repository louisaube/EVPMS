# Écran Les déclarations (`/declarations`) : plan de réalisation

Objet : liste filtrée des dossiers d'absence de l'utilisateur (état, période, crèche), avec accès au détail et, selon le rôle, à la création. Elle affiche les 200 dossiers les plus récents au plus.

## Parcours
1. L'utilisateur ouvre « Les déclarations ». Les filtres sont lus dans l'adresse (`?etat=…&du=…&au=…&creche=…`), ce qui permet les liens depuis « À faire » et « Les crèches ».
2. Attente pendant `GET /absences`, puis la liste.
3. Il modifie un filtre : l'adresse est mise à jour (remplacement d'historique) et la liste relue.
4. Clic sur une ligne ou « Ouvrir » : `/declarations/:id`.
5. Si le rôle le permet : « Nouvelle absence » vers `/declarations/nouvelle`.
6. États : vide (aucun dossier / aucun résultat pour les filtres), erreur avec « Réessayer ».

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Les déclarations » (`h1`) | — | — |
| Bouton de création | « Nouvelle absence » | Visible si capacité `absences:create` (directrice, RO, RH, superadmin ; jamais administratrice) | — |
| Filtre état | « État » (choix multiple : « À compléter », « Anticipée », « À valider », « Validée, à saisir dans PayFit », « Présente dans PayFit », « Rejetée », « Annulée » ; aucun choix = tous) | Paramètre répété `etat` | `GET /absences?status=` |
| Filtre période | « Du » et « Au » (dates natives) | Dossiers dont les dates chevauchent la période ; « Au » ≥ « Du » sinon « La date de fin doit suivre la date de début. » | `from`, `to` |
| Filtre crèche | « Crèche » (« Toutes les crèches ») | Affiché si plus d'une crèche visible | `crecheCode`, `GET /creches` |
| Filtres venus d'un lien | Pastille « Mois de paie : octobre 2026 » et « Dossiers ouverts seulement » | Affichées si `?mois=AAAA-MM&ouvertes=1` ; chaque pastille a un bouton « Retirer le filtre <nom> » | `payrollMonth`, `open=true` |
| Bouton « Effacer les filtres » | « Effacer les filtres » | Vide tous les filtres | — |
| Tableau (≥ 767 px) | colonnes « Salariée », « Crèche », « Type », « Période », « État », « Prochaine action », « Actions » | Ordre fixé par l'API : création décroissante ; pas de tri client | `GET /absences` |
| Cartes (< 767 px) | une carte par dossier avec les mêmes informations | Carte entière focalisable, nom accessible « Ouvrir le dossier de <salariée>, <type>, <période> » | idem |
| Cellule « Période » | « 03/11/2026 (matin) → 05/11/2026 (après-midi) » | Demi-journées en toutes lettres | — |
| Cellule « État » | `StatutAbsence` (libellé + icône) et, si dossier bloqué, le premier motif en une ligne | — | `blockages[0].message` |
| Cellule « Prochaine action » | Texte de l'API ; ex. « Ajouter l'avis d'arrêt », « Valider (RH) » | Mention « À arbitrer par la RH » en cas d'alerte PayFit | `nextAction.label` |
| Bouton de ligne | « Ouvrir » (nom accessible « Ouvrir le dossier de <salariée> ») | Vers le détail | — |
| Mention de plafond | « Les 200 dossiers les plus récents sont affichés. Affinez les filtres pour voir les autres. » | Affichée si `truncated` est vrai | `GET /absences` |
| Décompte | « N dossier(s) » | `aria-live="polite"` | — |

## Règles
- `rule-evp-list-filters` (user) : la liste se filtre par état et par période.
- `rule-evp-list-max-200` (user) : 200 dossiers récents au plus ; au-delà, la mention de plafond est affichée.
- `rule-evp-list-create-by-role` (user) : le bouton de création n'existe que si le rôle peut créer (jamais pour l'administratrice).
- `rule-evp-list-scope` (user) : directrice et RO ne voient que les dossiers de leurs crèches ; le filtrage est fait par l'API et la base, pas par l'écran.
- `rule-evp-list-status-labelled` (user) : chaque ligne montre un libellé de statut, un motif utile s'il est bloqué et la prochaine action, jamais une couleur seule.
- `rule-evp-list-url-state` (inferred) : filtres portés par l'adresse pour permettre les liens et le retour arrière.
- `rule-evp-list-empty` (inferred) : sans filtre « Aucune déclaration pour le moment. » (+ « Nouvelle absence » si permis) ; avec filtres « Aucune déclaration ne correspond à ces filtres. » + « Effacer les filtres ».
- `rule-evp-list-employee-key` (user) : une salariée est identifiée par société + contrat, jamais par son seul nom ; deux dossiers de même nom restent distincts et la ligne affiche le contrat (dates de début-fin) en texte secondaire.

## Accès
Tous les rôles. Directrice, RO : leurs crèches. RH, administratrice, superadmin : toutes. Le bouton « Nouvelle absence » est absent pour l'administratrice.

## Hypothèses
- Pas de pagination ni de recherche texte (la demande fixe « 200 dossiers récents au maximum »).
- Le filtre par crèche, les pastilles « mois de paie » et « dossiers ouverts » ne sont pas dans la demande : ils servent aux liens depuis « Les crèches » (clôture) et « À faire ».
- « Récent » = date de création décroissante.
- Le choix multiple d'états est plus utile que le choix unique ; l'API accepte un état répété.
