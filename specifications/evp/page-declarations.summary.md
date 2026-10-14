# Les déclarations (`/declarations`) : état réalisé

Liste filtrée des dossiers d'absence du périmètre de l'utilisateur. Code : `studio/src/app/features/absences/pages/DeclarationsPage.tsx`, `features/absences/components/AbsenceList.tsx`, `shared/components/StatutAbsence.tsx` ; API : `GET /absences` (`features/absences/`). Plan : `v1-evp/declarations-page-implementation-plan.md`.

## Ce qui existe
- **Filtres portés par l'adresse** (`rule-evp-list-url-state` inferred, `rule-evp-list-filters` user) : `?etat=…` (répétable, valeurs hors énumération ignorées), `du`, `au`, `creche`, `mois` (AAAA-MM) et `ouvertes=1` ; une valeur mal formée d'un lien modifié à la main est ignorée plutôt qu'envoyée à l'API. Chaque changement remplace l'entrée d'historique.
- **Contrôles** : « État » (choix multiple, aucun choix = tous, « Validée, à saisir dans PayFit » pour `A_SAISIR`), « Du » / « Au » (« La date de fin doit suivre la date de début. », aucun appel si inversé), « Crèche » (affiché si plus d'une crèche), « Effacer les filtres ». Les filtres venus d'un lien s'affichent en pastilles « Mois de paie : <mois année> » et « Dossiers ouverts seulement », chacune avec « Retirer le filtre <nom> ».
- **Création selon le rôle** (`rule-evp-list-create-by-role` user) : « Nouvelle absence » seulement avec la capacité `absences:create` (jamais pour l'administratrice).
- **Liste** (`rule-evp-list-scope` user, `rule-evp-list-status-labelled` user, `rule-evp-list-employee-key` user) : tableau dès 767 px (« Salariée », « Crèche », « Type », « Période », « État », « Prochaine action », « Actions »), cartes en dessous ; la salariée est accompagnée du libellé de son contrat (`contractLabel`), la période s'écrit avec ses demi-journées, l'état est `StatutAbsence` (libellé + icône), la prochaine action vient de l'API. Ordre de l'API (création décroissante), aucun tri côté client. Décompte « N dossier(s) ».
- **Plafond** (`rule-evp-list-max-200` user) : « Les 200 dossiers les plus récents sont affichés. Affinez les filtres pour voir les autres. » quand `truncated` est vrai.
- **États** (`rule-evp-list-empty` inferred) : attente, erreur avec « Réessayer », vide « Aucune déclaration pour le moment. » (avec « Nouvelle absence » si permis) ou « Aucune déclaration ne correspond à ces filtres. » avec « Effacer les filtres ».

## Limites connues
- Pas de pagination ni de recherche texte (200 dossiers au plus).
- Le filtrage par périmètre est fait par l'API et la base, pas par l'écran.
- Aucun test de navigateur n'a été exécuté pour ce résumé.
