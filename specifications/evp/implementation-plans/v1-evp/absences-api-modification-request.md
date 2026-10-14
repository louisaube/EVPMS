# Demande à l'API : déclarations d'absence, décisions, types et tableau « À faire »

Écrans demandeurs : À faire, Les déclarations, Nouvelle absence, Détail d'une absence. Besoin : lister, créer, lire et décider des dossiers d'absence dans le périmètre de l'appelant, avec les blocages, la prochaine action, la chronologie et l'alerte PayFit calculés par l'API (le studio ne recalcule ni droit ni transition).

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /absence-types` | `absences:types` | user, admin (tout compte EVP) | aucune | `200 { items: [{ code, label, expectedPiece: string \| null, privatePiece: boolean, hrReview: boolean }] }` : les 9 types par défaut |
| `GET /todo` | `todo:read` | user, admin (tout compte EVP) | query `crecheCode` (≤ 20), `from`, `to` (dates `AAAA-MM-JJ`, `to` ≥ `from`) | `200 { counters: { aCompleter: { count, hint }, enAttente: { count, hint }, refusees: { count, hint } }, priority: [AbsenceSummary] (50 au plus), recentActivity: [{ at, text, absenceId }] (10 au plus) }` ; `400` si `to` < `from` |
| `GET /absences` | `absences:list` | user, admin (tout compte EVP) | query `status` répétable (`A_COMPLETER`, `ANTICIPEE`, `A_VALIDER`, `A_SAISIR`, `DANS_PAYFIT`, `REJETEE`, `ANNULEE`), `from`, `to`, `crecheCode`, `payrollMonth` (`AAAA-MM`), `open` (booléen : états ouverts) | `200 { items: [AbsenceSummary] (200 au plus, création décroissante), truncated: boolean }` |
| `GET /absences/{id}` | `absences:get` | user, admin (tout compte EVP) | `id` UUID | `200 AbsenceDetail` ; `404 repository.not_found` (hors périmètre indiscernable d'un dossier inexistant) |
| `GET /absences/{id}/audit` | `absences:audit` | user, admin (capacité `journal:read`) | `id` UUID | `200 { items: [JournalEntry] }` ; `403` sans la capacité ; `404` |
| `POST /absences` | `absences:create` | user, admin (capacité `absences:create`) | corps `{ crecheCode: 1..20, contractId: UUID, typeCode: énumération des 9 types, startDate, startHalf: "MATIN" \| "APRES_MIDI", endDate, endHalf, comment?: 0..500, justificatifIds: UUID[0..5] }` | `201 AbsenceDetail` (état `A_COMPLETER` si blocage, `ANTICIPEE` si début futur, sinon `A_VALIDER`) ; `200 { duplicate: true, absence: AbsenceDetail }` pour un doublon exact actif ; `400 api.validation.incoming_failed` ; `403` ; `404 absences.contract_not_found` ; `409 absences.creche_contract_mismatch` (contrat d'une autre société que celle de la crèche ; rejoué plus tard, le même contrôle ne donne qu'un blocage) ; `409 absences.piece_not_attachable` (pièce inconnue, non confirmée, déjà rattachée ou d'une autre crèche) |
| `PATCH /absences/{id}` | `absences:update` | user, admin (capacité `absences:create`, dossier du périmètre) | `id` UUID ; corps `{ typeCode?, startDate?, startHalf?, endDate?, endHalf?, comment?: 0..500 \| null }`, au moins un champ, aucun autre (crèche et contrat ne changent pas) ; sans écran | `200 AbsenceDetail` (contrôles rejoués, état recalculé) ; `400` ; `403` ; `404` ; `409 absences.decision_not_allowed` (`DANS_PAYFIT`, `REJETEE`, `ANNULEE`) ; `409 absences.duplicate_active` |
| `POST /absences/{id}/submit` | `absences:submit` | user, admin (capacité `absences:create`) | `id` UUID, corps vide | `200 AbsenceDetail` après contrôles rejoués ; `409 absences.decision_not_allowed` |
| `POST /absences/validate-batch` | `absences:validate` | user, admin (capacité `absences:decide`) | corps `{ absenceIds: UUID[1..50] }` | `200 { validated: [{ id }], blocked: [{ id, employeeName, blockages: [{ code, message }] }] }` ; chaque dossier contrôlé et validé dans sa propre transaction ; `403` sinon |
| `POST /absences/{id}/validate` | `absences:validate` | user, admin (capacité `absences:decide`) | `id` UUID, corps vide | `200 AbsenceDetail` (`A_SAISIR`) ; `409 absences.validation_blocked` avec `details.blockages` (dossier inchangé) ; `409 absences.decision_not_allowed` ; `403` |
| `POST /absences/{id}/return` | `absences:return` | user, admin (capacité `absences:decide`) | corps `{ reason: 1..500 }` | `200 AbsenceDetail` (`A_COMPLETER`) ; `400` motif vide ou trop long ; `409 absences.decision_not_allowed` |
| `POST /absences/{id}/reject` | `absences:reject` | user, admin (capacité `absences:decide`) | corps `{ reason: 1..500 }` | `200 AbsenceDetail` (`REJETEE`) ; mêmes erreurs |
| `POST /absences/{id}/cancel` | `absences:cancel` | user, admin (selon statut et périmètre) | corps `{ reason: 1..500 }` | `200 AbsenceDetail` (`ANNULEE`) ; `409 absences.decision_not_allowed` (dossier confirmé ou terminé) |
| `POST /absences/{id}/mark-entered` | `absences:mark-entered` | user, admin (capacité `absences:decide`) | corps vide | `200 AbsenceDetail` (`status` inchangé `A_SAISIR`, `saisieDeclaree: true`) ; `409 absences.decision_not_allowed` |

Formes partagées :
- `AbsenceSummary` : `{ id, employeeName, crecheCode, crecheName, contractLabel, typeCode, typeLabel, startDate, startHalf, endDate, endHalf, status, saisieDeclaree, payrollMonth, createdAt, blockages: [{ code, message }], nextAction: { actor: "DECLARANT" \| "RH" \| "LECTURE_PAYFIT" \| "AUCUN", actorLabel, label }, selectable: boolean }`.
- `AbsenceDetail` : `AbsenceSummary` plus `employee { contractId, payfitContractId, companyName }`, `payfitCode`, `expectedPiece`, `comment`, `declaredBy`, `declaredAt`, `progress { step 1..5, total 5, label }`, `lastDecision { kind, byName, at, reason } \| null`, `pieces: [{ id, name, sizeBytes, confirmed, addedAt, addedByName, privatePiece, canOpen }]`, `payfitAlert { kind: "MODIFIEE" \| "ANNULEE" \| "DISPARUE", observedAt, change, priorProof } \| null`, `payfitProof { observedAt, company, code, sourceStatus } \| null`, `timeline: [{ at, kind, text, byName \| null }]`, `allowedActions: ("SUBMIT" \| "ATTACH" \| "VALIDATE" \| "RETURN" \| "REJECT" \| "CANCEL" \| "MARK_ENTERED")[]`.

## Règles
- `rule-evp-declare-steps` (user) : la création exige une crèche du périmètre de l'appelant, un contrat PayFit importé de cette crèche, un type, des dates avec demi-journées, et rattache les pièces confirmées.
- `rule-evp-declare-checks` (user) : à l'enregistrement, l'API contrôle l'identité crèche/contrat, la période contractuelle, les chevauchements (EVP et PayFit) et la pièce confirmée.
- `rule-evp-declare-result-status` (user) : un blocage donne `A_COMPLETER` ; sinon un début futur (jour Europe/Paris) donne `ANTICIPEE` ; sinon `A_VALIDER`.
- `rule-evp-declare-duplicate` (user) : un doublon exact actif (même contrat, type, dates, demi-journées, état non terminé) est renvoyé (`200`, `duplicate: true`), jamais recréé.
- `rule-evp-declare-overlap-blocks` (user) : un chevauchement avec une absence EVP active ou avec une absence PayFit observée bloque la complétude (blocage, pas une erreur HTTP).
- `rule-evp-declare-employee-key` (user) : la salariée est identifiée par société + contrat ; le seul nom n'est pas une clé.
- `rule-evp-declare-edit-server` (user) : un dossier non terminé (ni `DANS_PAYFIT`, ni `REJETEE`, ni `ANNULEE`) peut être modifié côté serveur ; les contrôles sont rejoués et l'état recalculé.
- `rule-evp-declare-no-auto-anticipation` (user) : une déclaration `ANTICIPEE` ne passe jamais seule à `A_VALIDER` au jour J.
- `rule-evp-declare-roles` (user) : directrice, RO, RH et superadmin créent ; l'administratrice reçoit `403`.
- `rule-evp-declare-no-medical-detail` (user) : le commentaire n'est jamais écrit dans les journaux techniques ni dans le résumé d'audit.
- `rule-evp-declare-types-defaults` (user) : congés payés (aucune pièce), arrêt maladie (avis d'arrêt, pièce privée), sans solde (accord écrit, examen RH), enfant malade (certificat), accident du travail (certificat et déclaration, examen RH), récupération (heures validées, examen RH), sans justificatif (aucune, examen RH), événement familial (acte), autre (aucune, examen RH).
- `rule-evp-declare-max-pieces` (inferred) : 5 pièces au plus par dossier.
- `rule-evp-declare-comment-bound` (inferred) : commentaire de 0 à 500 caractères.
- `rule-evp-declare-half-day-order` (inferred) : la fin n'est pas antérieure au début, demi-journée comprise.
- `rule-evp-decision-states` (user) : états : `A_COMPLETER`, `ANTICIPEE`, `A_VALIDER`, `A_SAISIR`, `DANS_PAYFIT`, `REJETEE`, `ANNULEE`.
- `rule-evp-decision-marine-only` (user) : valider (unitaire et lot), retourner, refuser et déclarer la saisie sont refusés `403` à tout autre rôle que RH ; le superadmin ne valide pas.
- `rule-evp-decision-reason-required` (user) : retourner, refuser et annuler exigent un motif administratif ; retour donne `A_COMPLETER`, refus donne `REJETEE`.
- `rule-evp-decision-replay-controls` (user) : soumission, resoumission et validation rejouent les contrôles ; un dossier devenu invalide n'est pas validé et ses blocages sont renvoyés.
- `rule-evp-batch-individual-controls` (user) : le lot contrôle chaque dossier individuellement ; succès et dossiers restés bloqués coexistent dans la réponse.
- `rule-evp-batch-max-50` (inferred) : un lot compte 1 à 50 identifiants distincts.
- `rule-evp-cancel-scope` (user) : l'annulation dépend du statut et du périmètre ; un dossier confirmé (`DANS_PAYFIT`) ou terminé ne suit pas librement ces transitions.
- `rule-evp-mark-entered-no-proof` (user) : la saisie effectuée ne change pas l'état ; seul `saisieDeclaree` passe à vrai.
- `rule-evp-payfit-no-manual-confirm` (user) : aucune route ne passe un dossier à `DANS_PAYFIT` ; seule la lecture PayFit suivie d'un rapprochement le fait (voir demande Sources).
- `rule-evp-arbitrage-rh` (user) : `nextAction.actor` vaut `RH` pour un dossier à arbitrer, jamais `DECLARANT`.
- `rule-evp-validated-is-to-enter` (user) : valider ne transmet rien à PayFit.
- `rule-evp-detail-actions-from-api` (inferred) : `allowedActions` est la seule source des boutons ; les transitions non autorisées donnent `409 absences.decision_not_allowed`.
- `rule-evp-detail-private-piece` (inferred) : `canOpen` est faux pour une pièce privée si l'appelant n'est ni RH, ni superadmin, ni son déposant.
- `rule-evp-list-max-200` (user) : au plus 200 dossiers, les plus récents ; `truncated` le signale.
- `rule-evp-list-scope` (user) : directrice et RO ne voient que leurs crèches ; hors périmètre : `404` indiscernable pour un dossier, absence pour une liste ; garanti par la base.
- `rule-evp-todo-counter-definition` (inferred) : « En attente » = `A_VALIDER` + `ANTICIPEE` + `A_SAISIR` ; « À compléter » = `A_COMPLETER` ; « Refusées » = `REJETEE`.
- `rule-evp-todo-priority-order` (inferred) : actionnables par l'appelant d'abord, puis début d'absence le plus proche.
- `rule-evp-closure-payroll-month` (user) : `payrollMonth` : jusqu'au 25 inclus, mois du début de l'absence ; après le 25, mois suivant la création, sauf début dans un mois futur (alors ce mois).
- `rule-evp-audit-atomic` (user) : chaque décision, création et ajout de pièce écrit sa trace d'audit dans la même transaction.
- `rule-evp-notification-read-no-effect` (user) : aucune route de lecture de notification ne modifie un dossier.

## Compatibilité
Routes entièrement nouvelles (fonctionnalités `absences`, `todo`). Aucune opération existante modifiée. Pas de formulaire général d'édition (hors demande) : `PATCH /absences/{id}` existe côté serveur seulement (`rule-evp-declare-edit-server`, « modification d'un dossier non terminé possible côté serveur ») et n'est appelée par aucun écran. Pas de rupture de contrat.
