# Écran Les crèches (`/creches`) : plan de réalisation

Objet : montrer les crèches visibles de l'utilisateur et, pour la directrice, la clôture mensuelle : vérifier qu'aucun dossier n'est ouvert pour le mois de paie et attester avoir vérifié les absences. Écran de la directrice ; les autres rôles le consultent sans pouvoir attester.

## Parcours
1. L'utilisateur ouvre « Les crèches ». Attente pendant `GET /creches`.
2. Il voit une carte par crèche (nom, code, SIRET, directrice, RO) et le mois de paie courant.
3. Il choisit une crèche (une seule : choisie d'office) puis un mois de paie ; l'état de la clôture est lu.
4. S'il y a des dossiers ouverts, un bandeau de blocage le dit avec le lien « Voir les dossiers ouverts » (liste filtrée) ; la case d'attestation et le bouton sont désactivés.
5. Sans dossier ouvert, la directrice coche « J'atteste avoir vérifié les absences de ce mois. » et clique « Clôturer le mois » ; confirmation dans un dialogue ; succès « Le mois d'octobre 2026 est clôturé pour <crèche>. ».
6. Un mois clôturé affiche « Clôturé le jj/mm/aaaa par <nom> » et aucune action.
7. États : vide (aucune crèche visible), erreur, interdit non applicable.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Les crèches » (`h1`) | — | — |
| Carte de crèche | Nom (`h2`), « Code : <code> », « SIRET : <siret> », « Directrice : <nom> » (« Non renseignée » sinon), « RO : <noms> » (« Aucune RO affectée » sinon) | Une carte sélectionnable (`aria-pressed`) ; sélection par défaut : la première | `GET /creches` |
| Pastille de vérification | « Crèche vérifiée » ou « Non vérifiée » (texte + icône) | Information seulement | `verified` |
| Sélecteur de mois | « Mois de paie » (liste : mois courant et cinq précédents, « octobre 2026 ») | Relit la clôture du mois choisi | `GET /creches/{code}/closures` |
| Statut du mois | « Ouvert » avec le nombre de dossiers ouverts ou « Clôturé » | Texte + icône | `items[].status`, `openCount` |
| Bandeau de blocage | « La clôture est impossible : N dossier(s) ouvert(s) pour ce mois de paie, y compris ceux « à saisir ». » (fond vigilance) | Affiché si `openCount` > 0 | `openCount` |
| Lien | « Voir les dossiers ouverts » | `/declarations?creche=<code>&mois=AAAA-MM&ouvertes=1` | — |
| Case d'attestation | « J'atteste avoir vérifié les absences de ce mois. » | Visible pour la capacité `closures:attest` ; désactivée si dossiers ouverts ou mois clôturé | — |
| Bouton de clôture | « Clôturer le mois » ; « Clôture en cours… » | Désactivé tant que la case n'est pas cochée ; un seul envoi | `POST /creches/{code}/closures/{month}` |
| Dialogue | « Clôturer octobre 2026 pour <crèche> ? » « Vous attestez avoir vérifié les absences. Cette action est tracée au journal. » ; « Annuler » / « Clôturer » | — | — |
| Mention de clôture | « Clôturé le jj/mm/aaaa à hh:mm par <nom>. » | Si clôturé | `closedAt`, `closedByName` |
| Mention pour les autres rôles | « La clôture est attestée par la directrice de la crèche. » | RO, RH, administratrice, superadmin : pas de case ni de bouton | — |
| Vide | « Aucune crèche n'est visible pour votre compte. Contactez la RH. » | — | — |

### Échecs de la clôture
| Réponse | Message |
|---|---|
| `409 closures.open_absences` | « Des dossiers sont encore ouverts pour ce mois : la clôture est impossible. » et rechargement du décompte |
| `409 closures.already_closed` | « Ce mois est déjà clôturé. » |
| `400` | « Données invalides. Vérifiez les champs. » |
| `403` | « Action non autorisée. » |

## Règles
- `rule-evp-closure-visible` (user) : la clôture mensuelle est visible dans l'interface, sur l'écran « Les crèches » (écran de la directrice).
- `rule-evp-closure-attest` (user) : la directrice atteste avoir vérifié les absences.
- `rule-evp-closure-open-blocks` (user) : un dossier ouvert, même « à saisir », bloque la clôture ; « ouvert » = `A_COMPLETER`, `ANTICIPEE`, `A_VALIDER`, `A_SAISIR`.
- `rule-evp-closure-payroll-month` (user) : mois de paie : jusqu'au 25 inclus (date de création), mois de début de l'absence ; après le 25, mois suivant la création, sauf début dans un mois futur, auquel cas ce mois futur est retenu. Calculé par l'API (`payrollMonth` de chaque dossier) ; l'écran l'affiche.
- `rule-evp-closure-api-roles` (user) : l'API autorise aussi la clôture aux rôles déclarants dans leur périmètre ; l'écran ne l'offre qu'à la directrice.
- `rule-evp-creche-scope` (user) : la directrice et la RO ne voient que leurs crèches ; RH, administratrice et superadmin voient toutes les crèches (consultation globale).
- `rule-evp-closure-month-choice` (inferred) : le sélecteur propose le mois de paie courant et les cinq précédents.
- `rule-evp-closure-no-reopen` (inferred) : aucune réouverture de mois n'est proposée.
- `rule-evp-creche-readonly` (inferred) : les crèches ne se créent ni ne se modifient depuis l'écran ; leur référentiel vient de la lecture du Google Sheets « Contacts des crèches » (écran Sources).

## Accès
Tous les rôles. Directrice et RO : leurs crèches. RH, administratrice, superadmin : toutes. Case et bouton de clôture : capacité `closures:attest` (directrice).

## Hypothèses
- Les cinq autres rôles consultent les crèches et l'état de clôture en lecture seule (la demande ne l'interdit pas ; l'administratrice « gère les RO et leurs crèches »).
- Le mois de paie courant pour le sélecteur est celui du jour de la requête calculé comme pour une création du jour (si le jour dépasse le 25, c'est le mois suivant).
- On peut clôturer un mois passé ou courant ; un mois futur n'est pas proposé.
- Déclarer ou modifier un dossier dans un mois déjà clôturé n'est pas traité par la demande ; l'écran de déclaration ne l'empêche pas (point à arbitrer).
- Le SIRET et les noms de directrice/RO sont des informations du référentiel et sont affichées telles quelles.
