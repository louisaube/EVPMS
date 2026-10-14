# Écran À faire (`/`) : plan de réalisation

Objet : page d'arrivée de tous les rôles. Elle dit ce qui attend l'utilisateur (compteurs adaptés au rôle, dossiers prioritaires, activité récente) et, pour Marine (RH), permet la validation en lot. Elle remplace l'accueil provisoire « Bienvenue » du socle.

## Parcours
1. Arrivée après connexion (ou clic sur « À faire »). Indicateur d'attente pendant `GET /todo`.
2. L'utilisateur voit trois compteurs, des filtres (crèche, période), la liste des dossiers prioritaires et l'activité récente.
3. Un clic sur un compteur ouvre `/declarations` avec le filtre correspondant ; un clic sur un dossier ouvre `/declarations/:id`.
4. RH uniquement : cocher des dossiers « À valider » dans la liste prioritaire, « Valider la sélection (N) », confirmer dans le dialogue ; un récapitulatif liste les succès et les dossiers restés bloqués avec leur motif.
5. États : vide (rien à faire), erreur avec « Réessayer », interdit (jamais : tous les rôles ont accès).

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « À faire » (`h1`) | — | — |
| Filtre crèche | « Crèche » (liste ; « Toutes les crèches » par défaut) | Affiché si l'utilisateur voit plus d'une crèche ; relit `GET /todo` | `GET /creches` pour les options |
| Filtre période | « Du » et « Au » (sélecteurs de date natifs) | Période appliquée au chevauchement des dates d'absence ; vide = pas de borne ; « Au » ≥ « Du » sinon message « La date de fin doit suivre la date de début. » et pas d'appel | `GET /todo?from=&to=` |
| Bouton « Effacer les filtres » | « Effacer les filtres » | Remet crèche et période à vide | — |
| Compteur 1 | « À compléter » + nombre | Lien vers `/declarations?etat=A_COMPLETER` (+ filtres) ; texte d'aide selon le rôle (voir ci-dessous) | `GET /todo` (`counters.aCompleter`) |
| Compteur 2 | « En attente » + nombre | Lien vers `/declarations?etat=A_VALIDER&etat=ANTICIPEE&etat=A_SAISIR` | `counters.enAttente` |
| Compteur 3 | « Refusées » + nombre | Lien vers `/declarations?etat=REJETEE` | `counters.refusees` |
| Section « Dossiers prioritaires » | « Dossiers prioritaires » (`h2`) | Liste (tableau ≥ 767 px, cartes en dessous), 50 au plus : salariée, crèche, type, période, statut (`StatutAbsence`), prochaine action | `GET /todo` (`priority`) |
| Case de sélection d'un dossier | « Sélectionner le dossier de <salariée> » | RH seulement ; active seulement pour un dossier `A_VALIDER` (désactivée sinon, avec l'infobulle « Ce dossier n'est pas à valider. ») | — |
| Case « tout sélectionner » | « Sélectionner tous les dossiers à valider » | RH seulement ; ne coche que les dossiers `A_VALIDER` affichés | — |
| Bouton de lot | « Valider la sélection (N) » | RH seulement ; désactivé si N = 0 ou N > 50 (« 50 dossiers au plus par lot. ») ; ouvre le dialogue | — |
| Dialogue de lot | Titre « Valider N dossier(s) ? » ; texte « Chaque dossier est contrôlé individuellement. Un dossier devenu invalide reste bloqué. Valider ne transmet rien à PayFit : la saisie reste à faire. » ; boutons « Annuler » et « Valider » | Pendant l'envoi : boutons désactivés, « Validation en cours… » ; un seul envoi malgré des clics répétés | `POST /absences/validate-batch` |
| Récapitulatif de lot | « N dossier(s) validé(s). M dossier(s) restent bloqué(s). » puis liste des bloqués : salariée, motif(s), lien « Ouvrir le dossier » | `role="status"` ; la liste est rechargée ensuite ; les dossiers bloqués restent cochables | réponse du lot |
| Lien d'extension | « Voir toutes les déclarations » | Vers `/declarations` avec les filtres actifs | — |
| Section « Activité récente » | « Activité récente » (`h2`) | 10 événements au plus : date-heure, texte de l'événement (« Demande retournée par RH », « Absence présente dans PayFit »…), lien vers le dossier | `GET /todo` (`recentActivity`) |
| Bouton « Réessayer » | « Réessayer » | Relance `GET /todo` | — |

### Aide sous les compteurs (selon `GET /profile`)
| Rôle | « À compléter » | « En attente » | « Refusées » |
|---|---|---|---|
| Directrice, RO | « Dossiers de vos crèches que vous devez compléter. » | « Dossiers de vos crèches en attente de la RH ou de PayFit. » | « Dossiers de vos crèches refusés par la RH. » |
| RH | « Dossiers renvoyés aux crèches pour complément. » | « Dossiers à valider ou à saisir : c'est à vous d'agir. » | « Dossiers que vous avez refusés. » |
| Administratrice, Superadmin | « Dossiers en attente de complément dans toutes les crèches. » | « Dossiers en attente de validation ou de saisie. » | « Dossiers refusés. » |

Le texte de l'aide est rédigé par l'API dans `counters.*.hint` ; le studio l'affiche tel quel (repli : texte du tableau).

## Règles
- `rule-evp-todo-role-counters` (user) : l'écran affiche des compteurs adaptés au rôle (À compléter, En attente, Refusées), des filtres, une période, des dossiers prioritaires et l'activité récente.
- `rule-evp-todo-counter-definition` (inferred) : « En attente » = `A_VALIDER` + `ANTICIPEE` + `A_SAISIR` ; « À compléter » = `A_COMPLETER` ; « Refusées » = `REJETEE`. Calcul fait par l'API sur le périmètre de l'appelant.
- `rule-evp-todo-priority-order` (inferred) : ordre des dossiers prioritaires fixé par l'API (actionnables par l'utilisateur d'abord, puis début d'absence le plus proche) ; le studio ne trie pas.
- `rule-evp-batch-validate-rh-only` (user) : la sélection et le bouton de lot n'existent que pour RH ; l'API refuse `403` à tout autre rôle.
- `rule-evp-batch-individual-controls` (user) : chaque dossier du lot est contrôlé individuellement ; un lot peut mêler succès et dossiers restant bloqués, et l'écran le dit.
- `rule-evp-batch-max-50` (inferred) : un lot compte au plus 50 dossiers (borne déclarée au contrat).
- `rule-evp-validate-is-not-transmit` (user) : l'écran rappelle que valider ne transmet rien à PayFit.
- `rule-evp-todo-read-notification-no-effect` (user) : aucun compteur ni aucune activité n'est modifié par la lecture d'une notification.
- `rule-evp-todo-empty-state` (inferred) : sans dossier, « Rien à faire pour le moment. » et, pour les déclarants, le bouton « Nouvelle absence ».

## Accès
Tous les rôles connectés. Directrice et RO ne voient que les dossiers de leurs crèches (filtre serveur et base). Administratrice : lecture globale, jamais de sélection ni de lot. Superadmin : lecture globale, jamais de lot (il ne valide pas).

## Hypothèses
- Les « dossiers prioritaires » sont plafonnés à 50 pour correspondre au plafond du lot ; la demande ne donne aucun nombre.
- L'activité récente reprend les 10 derniers événements de chronologie visibles de l'utilisateur ; la demande ne donne ni nombre ni source.
- Les trois compteurs sont des liens vers la liste filtrée (non précisé dans la demande).
- Les dossiers `ANTICIPEE` sont comptés « En attente » (la demande ne classe pas cet état).
- La période filtre par chevauchement avec les dates d'absence, comme l'export.
- L'état « À arbitrer » (alerte PayFit à trancher) n'a pas de compteur propre ; il apparaît dans la prochaine action du dossier (« À arbitrer par la RH »).
