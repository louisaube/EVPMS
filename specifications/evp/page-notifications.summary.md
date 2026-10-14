# Notifications (`/notifications`) : état réalisé

Liste des événements reçus, compteur de non-lues et marquage lu. Code : `studio/src/app/features/notifications/pages/NotificationsPage.tsx`, `features/auth/hooks/useProfile.tsx` (compteur de la navigation) ; API : `features/notifications/` (`GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`) et `ReconciliationService` qui les crée. Plan : `v1-evp/notifications-page-implementation-plan.md`.

## Ce qui existe
- **Liste** (`rule-evp-notif-list` user, `rule-evp-notif-max-100` user) : 100 notifications au plus, les plus récentes d'abord ; « Les 100 notifications les plus récentes sont affichées. » si `truncated`. Chaque élément montre « Non lue » (point, graisse et texte, pas la couleur seule) ou « Lue », une pastille de type (« Confirmation PayFit », « Modification PayFit », « Annulation PayFit », « Disparition PayFit », « Restauration PayFit », « Information » pour un type inconnu), le titre, le message, la crèche et la date-heure.
- **Texte de l'API** (`rule-evp-notif-text-from-api` inferred, `rule-evp-notif-no-medical` user) : titres et messages sont rédigés en français par l'API et affichés en texte brut.
- **Compteur** : « N non lue(s) » ou « Aucune notification non lue. » en `aria-live="polite"`, mis à jour après chaque marquage, le compteur de la navigation avec (`setUnreadCount`).
- **Filtre** : interrupteur « Afficher seulement les non lues » (`unreadOnly`).
- **Deux actions distinctes** (`rule-evp-notif-open-not-read` inferred) : « Ouvrir le dossier » (nom accessible « Ouvrir le dossier de <salariée> ») ne marque pas comme lue ; « Marquer comme lue » (nom accessible « Marquer comme lue la notification : <titre> ») appelle `POST /notifications/:id/read` et fait passer l'élément à « Lue » sans recharger la liste.
- **Lire ne décide rien** (`rule-evp-notif-read-decides-nothing` user) : aucune décision n'est proposée ; l'état lu est propre à chaque destinataire (`rule-evp-notif-per-user-read` inferred) et limité à son périmètre (`rule-evp-notif-scope` inferred), garanti par la base.
- **États** : attente, erreur avec « Réessayer », vide « Aucune notification pour le moment. » ou, filtre actif, « Aucune notification non lue. ».

## Limites connues
- Seules les notifications du rapprochement PayFit existent ; aucune notification de décision (retour, refus).
- Pas de « Tout marquer comme lu ».
- Un échec de marquage s'annonce par une notification d'erreur, sans état intermédiaire dans la liste.
- Aucun test de navigateur n'a été exécuté pour ce résumé.
