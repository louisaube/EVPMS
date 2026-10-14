# Écran Notifications (`/notifications`) : plan de réalisation

Objet : lister les événements reçus (retours de PayFit : confirmation, modification, annulation, disparition, restauration), voir le compteur de non-lues, ouvrir le dossier et marquer une notification comme lue. Lire ne décide rien.

## Parcours
1. L'utilisateur ouvre « Notifications » (le compteur de l'entrée de navigation donne le nombre de non-lues).
2. Attente pendant `GET /notifications`, puis la liste (100 au plus, la plus récente d'abord).
3. Il ouvre le dossier d'une notification (`/declarations/:id`) ou la marque comme lue ; le compteur de la navigation est mis à jour.
4. États : vide, erreur avec « Réessayer ».

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Notifications » (`h1`) | — | — |
| Compteur | « N non lue(s) » (`aria-live="polite"`) ; « Aucune notification non lue. » à 0 | Mis à jour après chaque marquage | `unreadCount` de `GET /notifications` |
| Filtre | « Afficher seulement les non lues » (interrupteur) | Relit la liste avec `unreadOnly=true` | `GET /notifications?unreadOnly=` |
| Élément de liste | Titre (ex. « Absence présente dans PayFit »), message (ex. « L'absence de <salariée>, du 03/11/2026 au 05/11/2026, a été retrouvée dans PayFit. »), crèche, date-heure | Une notification non lue est annoncée « Non lue » (texte + point + graisse, pas la couleur seule) | `items` |
| Type | Pastille texte : « Confirmation PayFit », « Modification PayFit », « Annulation PayFit », « Disparition PayFit », « Restauration PayFit » | Un type inconnu est affiché « Information » | `kind` |
| Lien du dossier | « Ouvrir le dossier » (nom accessible « Ouvrir le dossier de <salariée> ») | Navigue vers le dossier ; ne marque pas la notification comme lue | — |
| Bouton de marquage | « Marquer comme lue » (nom accessible « Marquer comme lue la notification : <titre> ») | Visible si non lue ; `POST /notifications/{id}/read` ; l'élément passe à « Lue » sans rechargement | `POST /notifications/{id}/read` |
| Mention de plafond | « Les 100 notifications les plus récentes sont affichées. » | Si `truncated` | `GET /notifications` |
| Vide | « Aucune notification pour le moment. » ; si filtre actif : « Aucune notification non lue. » | — | — |

## Règles
- `rule-evp-notif-list` (user) : la liste affiche les événements reçus, un compteur de non-lues, l'ouverture du dossier et le marquage lu.
- `rule-evp-notif-max-100` (user) : la liste est limitée à 100 notifications.
- `rule-evp-notif-read-decides-nothing` (user) : lire ou marquer une notification ne change jamais le dossier ; l'écran ne propose aucune décision.
- `rule-evp-notif-open-not-read` (inferred) : ouvrir le dossier et marquer comme lue sont deux actions distinctes.
- `rule-evp-notif-per-user-read` (inferred) : l'état lu est propre à chaque utilisateur ; marquer lue pour soi ne la marque pas pour les autres.
- `rule-evp-notif-scope` (inferred) : un utilisateur ne reçoit que les notifications des dossiers de son périmètre (directrice, RO : leurs crèches ; RH, administratrice, superadmin : toutes).
- `rule-evp-notif-no-medical` (user) : titre et message ne contiennent aucun détail médical.
- `rule-evp-notif-text-from-api` (inferred) : titres et messages sont rédigés en français par l'API et affichés en texte brut.

## Accès
Tous les rôles connectés, dans leur périmètre. Aucune action de décision depuis cet écran.

## Hypothèses
- Les notifications de la v1 sont celles issues du rapprochement PayFit (la demande cite « les notifications » enregistrées avec la preuve et l'événement de confirmation, et les alertes de modification, d'annulation, de disparition, de restauration). Aucune notification de décision (retour, refus) n'est créée.
- Pas de « Tout marquer comme lu » (non demandé).
- Les destinataires par défaut sont tous les utilisateurs ayant accès au dossier ; l'API peut restreindre.
- Le compteur de non-lues de la navigation utilise `GET /notifications/unread-count`.
