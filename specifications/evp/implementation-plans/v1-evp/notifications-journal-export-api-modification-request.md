# Demande à l'API : notifications, journal et export paie

Écrans demandeurs : Notifications (et compteur de la mise en page), Journal, Export paie. Besoin : lire et marquer les notifications, lire le journal d'EVP, produire le CSV des absences d'une période en le journalisant.

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /notifications` | `notifications:list` | user, admin (tout compte EVP) | query `unreadOnly` booléen | `200 { items: [{ id, kind: "CONFIRMATION" \| "MODIFICATION" \| "ANNULATION" \| "DISPARITION" \| "RESTAURATION", title, message, crecheName, absenceId, employeeName, createdAt, read: boolean }] (100 au plus, récentes d'abord), unreadCount, truncated }` |
| `GET /notifications/unread-count` | `notifications:count` | user, admin (tout compte EVP) | aucune | `200 { unreadCount }` |
| `POST /notifications/{id}/read` | `notifications:read` | user, admin (destinataire) | `id` UUID, corps vide | `200 { id, read: true }` ; idempotent ; `404` si la notification n'est pas celle de l'appelant |
| `GET /journal-entries` | `journal:list` | user, admin (capacité `journal:read` : RH, superadmin) | query `operation` (code de `filters`), `actorId` UUID, `dateFrom`, `dateTo` (dates, `dateTo` ≥ `dateFrom`), `absenceId` UUID, pagination du socle : `from` entier ≥ 0 et `size` ∈ {10, 25, 50} (défaut 25) | `200 { items: [{ id, occurredAt, actorName, actorEmail \| null, operation, operationLabel, summary, absenceId: UUID \| null }], total }` ; ordre fixe : plus récent d'abord ; `403` sinon |
| `GET /journal-entries/filters` | `journal:filters` | user, admin (capacité `journal:read`) | aucune | `200 { operations: [{ code, label }], actors: [{ id, name }] }` |
| `POST /exports/absences` | `exports:absences` | user, admin (capacité `export:run` : RH, superadmin) | corps `{ from: date, to: date }` avec `to` ≥ `from` et au plus 366 jours | `200` `text/csv; charset=utf-8` avec `Content-Disposition: attachment; filename="absences-AAAA-MM-JJ_AAAA-MM-JJ.csv"` ; `400 api.validation.incoming_failed` ; `403` |

## Règles
- `rule-evp-notif-list` (user) : la liste fournit les événements reçus, le compteur de non-lues et le marquage lu.
- `rule-evp-notif-max-100` (user) : 100 notifications au plus.
- `rule-evp-notif-read-decides-nothing` (user) : marquer lue ne modifie aucun dossier ; `POST /notifications/{id}/read` n'écrit que l'état de lecture du destinataire.
- `rule-evp-notif-per-user-read` (inferred) : l'état lu est propre à chaque destinataire.
- `rule-evp-notif-scope` (inferred) : seules les notifications de dossiers du périmètre de l'appelant sont visibles ; garanti par la base.
- `rule-evp-notif-created-with-proof` (user) : les notifications sont créées dans la même transaction que la preuve et l'événement de confirmation, et pour chaque alerte ou restauration PayFit.
- `rule-evp-notif-no-medical` (user) : titre et message ne contiennent aucun détail médical ; ils sont rédigés en français par l'API.
- `rule-evp-notif-read-not-journaled` (inferred) : le marquage lu est exempté de la trace d'audit (aucune donnée métier modifiée), avec sa raison déclarée.
- `rule-evp-journal-readonly` (user) : journal en lecture seule, réservé à RH et superadmin ; aucune route d'écriture ni de suppression.
- `rule-evp-journal-covers` (user) : y figurent les gestions d'accès, exports, ouvertures de justificatifs, décisions, clôtures et lectures de sources, avec auteur, instant et résumé administratif.
- `rule-evp-journal-no-medical` (user) : aucun document ni détail médical, aucun nom de fichier de pièce privée, aucune valeur brute de corps.
- `rule-evp-journal-source` (inferred) : lu depuis `base.audit_logs` du socle (gelé), avec noms joints et libellés d'opération traduits en français ; `GET /audit-logs` du socle reste inchangé.
- `rule-evp-journal-pagination` (inferred) : `from` ≥ 0, `size` ∈ {10, 25, 50}, 25 par défaut.
- `rule-evp-export-roles` (user) : RH et superadmin seulement ; `403` pour tout autre rôle.
- `rule-evp-export-period` (user) : toute absence dont les dates chevauchent la période (bornes comprises) est incluse.
- `rule-evp-export-columns` (user) : colonnes « Crèche », « Salariée », « Contrat », « Type », « Code PayFit », « Début », « Demi-journée de début », « Fin », « Demi-journée de fin », « Statut », « Motif administratif ».
- `rule-evp-export-csv-format` (inferred) : UTF-8 avec BOM, séparateur `;`, fins de ligne CRLF, dates `AAAA-MM-JJ`, demi-journées `MATIN` / `APRES_MIDI`, protection contre l'injection de formule (cellule commençant par `=`, `+`, `-`, `@` préfixée d'une apostrophe).
- `rule-evp-export-all-statuses` (inferred) : tous les états sont exportés.
- `rule-evp-export-audited` (user) : chaque export écrit une entrée de journal (période, nombre de lignes, auteur) dans la même transaction ; aucun nom de salariée dans le résumé.
- `rule-evp-export-no-payfit-write` (user) : l'export ne déclenche ni import ni écriture dans PayFit.
- `rule-evp-export-post-for-audit` (inferred) : opération `POST` pour être tracée par le socle ; aucune donnée métier modifiée.
- `rule-evp-export-max-span` (inferred) : période de 366 jours au plus, déclarée au contrat.

## Compatibilité
Routes entièrement nouvelles (fonctionnalités `notifications`, `journal`, `exports`). La réponse CSV n'est pas du JSON : le contrat la déclare avec le type `text/csv` et un schéma `string`. Pas de rupture de contrat.
