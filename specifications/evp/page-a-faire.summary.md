# À faire (`/`) : état réalisé

Page d'arrivée de tous les rôles ; elle remplace l'accueil « Bienvenue » du socle (`rule-foundation-home-replaceable`). Code : `studio/src/app/features/todo/pages/TodoPage.tsx`, `features/absences/components/AbsenceList.tsx`, `features/creches/hooks/useCreches.ts` ; API : `GET /todo` et `POST /absences/validate-batch` (`features/absences/`). Plan : `v1-evp/a-faire-page-implementation-plan.md`.

## Ce qui existe
- **Compteurs par rôle** (`rule-evp-todo-role-counters` user, `rule-evp-todo-counter-definition` inferred) : « À compléter », « En attente » (`A_VALIDER` + `ANTICIPEE` + `A_SAISIR`), « Refusées », chacun un lien vers `/declarations` filtré (`?etat=…` plus les filtres actifs `creche`, `du`, `au`) ; le texte d'aide vient de l'API (`counters.*.hint`), avec un repli court dans le studio.
- **Filtres** : « Crèche » (affiché si plus d'une crèche visible, « Toutes les crèches »), « Du » et « Au » (message « La date de fin doit suivre la date de début. » et aucun appel si l'ordre est inversé), « Effacer les filtres ». Les filtres sont dans l'état du composant, pas dans l'adresse.
- **Dossiers prioritaires** (`rule-evp-todo-priority-order` inferred) : liste renvoyée par l'API dans son ordre (50 au plus), via `AbsenceList` (tableau dès 767 px, cartes en dessous) avec décompte « N dossier(s) » ; lien « Voir toutes les déclarations ».
- **Validation en lot réservée à RH** (`rule-evp-batch-validate-rh-only` user) : colonne de cases visible seulement avec la capacité `absences:decide` ; seules les lignes `selectable` (dossiers « À valider ») sont cochables, infobulle « Ce dossier n'est pas à valider. » ; case « Sélectionner tous les dossiers à valider » ; bouton « Valider la sélection (N) » désactivé à 0 ou au-delà de 50 (« 50 dossiers au plus par lot. », `rule-evp-batch-max-50` inferred). Les identifiants sélectionnés qui ne sont plus listés sont écartés.
- **Dialogue et récapitulatif** (`rule-evp-batch-individual-controls` user, `rule-evp-validate-is-not-transmit` user) : titre « Valider N dossier(s) ? », rappel que chaque dossier est contrôlé individuellement et que valider ne transmet rien à PayFit, « Validation en cours… » et un seul envoi ; récapitulatif `role="status"` « N dossier(s) validé(s). M dossier(s) restent bloqué(s). » avec, pour chaque bloqué, la salariée, les motifs et « Ouvrir le dossier » ; les bloqués restent sélectionnés, la liste est rechargée.
- **Activité récente** : 10 événements au plus (date-heure, texte, « Ouvrir le dossier »), ou « Aucune activité récente. ». Aucune lecture de notification ne la modifie (`rule-evp-todo-read-notification-no-effect` user).
- **États** : attente, erreur avec « Réessayer », vide « Rien à faire pour le moment. » avec « Nouvelle absence » pour les déclarants (`rule-evp-todo-empty-state` inferred).

## Limites connues
- Les filtres de cette page ne sont pas portés par l'adresse (contrairement à « Les déclarations »).
- Le plafond de 50 dossiers prioritaires est une hypothèse du plan, appliquée par l'API.
- L'état « À arbitrer » n'a pas de compteur propre : il apparaît dans la prochaine action du dossier.
- Aucun test de navigateur n'a été exécuté pour ce résumé.
