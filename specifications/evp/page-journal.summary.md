# Journal (`/journal`) : état réalisé

Lecture seule des actions horodatées d'EVP ; remplace sur `/journal` l'écran d'audit du socle. Code : `studio/src/app/features/journal/pages/JournalPage.tsx` ; API : `features/journal/` (`GET /journal-entries`, `GET /journal-entries/filters`, `GET /absences/:id/audit`). Plan : `v1-evp/journal-page-implementation-plan.md`.

## Ce qui existe
- **Réservé à RH et au superadmin** (`rule-evp-journal-readonly` user, `rule-evp-journal-guard` inferred) : route sous `RequireCapability("journal:read")`, hors du groupe `RequireAdmin` du socle ; les autres voient « Accès refusé » sans appel, l'API répond `403`. Aucune route d'écriture.
- **Socle remplacé** (`rule-evp-journal-supersedes-foundation` inferred) : l'écran n'appelle plus `GET /audit-logs` ; l'ancien écran `features/audit/pages/JournalPage.tsx` reste dans le dépôt, non lié.
- **Contenu** (`rule-evp-journal-covers` user, `rule-evp-journal-no-medical` user) : note « Lecture seule : le journal ne peut être ni modifié ni effacé. Il ne contient aucun détail médical. » ; colonnes « Date et heure » (`jj/mm/aaaa à hh:mm:ss`), « Auteur » (nom puis adresse, « Système » pour les actions automatiques), « Opération » (libellé français de l'API) et « Détail » (résumé administratif) ; cartes sous 767 px. L'API restreint les lignes à une liste blanche d'actions EVP (déclarations, décisions, accès, clôtures, justificatifs, export, lectures de sources, rapprochement PayFit) et jamais celles du socle.
- **Texte brut** (`rule-evp-journal-plain-text` inferred) : le détail est rendu comme texte échappé, jamais interprété comme HTML. Un lien « Ouvrir le dossier » apparaît quand l'entrée porte un `absenceId`.
- **Filtres portés par l'adresse** (`rule-evp-journal-url-state` inferred) : « Opération » et « Auteur » (options de `GET /journal-entries/filters`), « Du » et « Au » (message d'inversion, aucune ligne demandée), « Effacer les filtres » ; valeurs hors format ignorées.
- **Pagination et ordre** (`rule-evp-journal-pagination` inferred, `rule-evp-journal-order` inferred) : pagination serveur 10 / 25 / 50, 25 par défaut, plus récent d'abord, ordre non modifiable côté studio. Vide : « Aucune entrée dans le journal pour ces filtres. ».
- La fiche d'un dossier réutilise `GET /absences/:id/audit` pour sa carte « Audit » (voir `page-detail-absence.summary.md`).

## Limites connues
- Les connexions ne sont pas journalisées (la demande ne le réclame pas).
- Le filtre « Auteur » n'était pas demandé ; il a été ajouté pour la lecture.
- L'ouverture d'une pièce privée est journalisée sans le nom du fichier.
- Aucun test de navigateur n'a été exécuté pour ce résumé.
