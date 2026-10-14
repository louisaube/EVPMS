# Écran Journal (`/journal`) : plan de réalisation

Objet : lecture seule des actions horodatées d'EVP (auteur, opération, détail administratif) pour RH et le superadmin. Remplace sur `/journal` l'écran du socle « Journal d'audit » (`features/audit/pages/JournalPage.tsx`) : même adresse, mêmes principes, mais données (routes `/journal-entries`) et garde propres à EVP. Le socle place `/journal` sous `RequireAdmin` dans `App.tsx` (RH est un compte `user`, il y serait refusé) : la route `/journal` d'EVP est donc sortie de ce groupe et protégée par la capacité `journal:read`.

## Réutilisation
- Écran : partir de `JournalPage.tsx` et réutiliser `features/audit/hooks/auditFilters.ts` (paramètres d'adresse, bornes de jour, dates françaises) et `shared/usePagedList.ts`, `shared/components/AdminList.tsx`, `PageHeader.tsx`, `useCall.ts` ; ne pas recopier la pagination ni les états de liste. Les filtres « Opération » et « Auteur » sont remplacés par ceux de `GET /journal-entries/filters` ; le champ `action`/`objectType`/`scope` du socle n'est pas exposé.
- API : `JournalService` reprend le calcul des bornes d'instants de `AuditService.list` (même table `auditLogs`) au lieu de le réécrire.

## Parcours
1. L'utilisateur ouvre « Journal ». Attente pendant `GET /journal-entries` et `GET /journal-entries/filters`.
2. Il filtre par opération, auteur, période ; la liste est paginée côté serveur.
3. Il lit chaque ligne ; un lien « Ouvrir le dossier » est proposé quand l'entrée concerne une absence.
4. États : vide, erreur avec « Réessayer », interdit.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Journal » (`h1`) | — | — |
| Note | « Lecture seule : le journal ne peut être ni modifié ni effacé. Il ne contient aucun détail médical. » | Texte fixe | — |
| Filtre opération | « Opération » (« Toutes ») | Options issues des entrées existantes | `GET /journal-entries/filters` |
| Filtre auteur | « Auteur » (« Tous ») | Options issues des entrées existantes | idem |
| Filtre période | « Du » et « Au » (dates natives) | « Au » ≥ « Du » sinon « La date de fin doit suivre la date de début. » | `dateFrom`, `dateTo` (dates) |
| Bouton « Effacer les filtres » | « Effacer les filtres » | — | — |
| Tableau | colonnes « Date et heure », « Auteur », « Opération », « Détail » (+ « Dossier » si lien) | Tri fixe : plus récent d'abord ; pagination 10 / 25 / 50, 25 par défaut (« Lignes par page : », « 1–25 sur 130 ») ; cartes sous 767 px | `GET /journal-entries?from=&size=` |
| Cellule « Date et heure » | `jj/mm/aaaa à hh:mm:ss` | — | `occurredAt` |
| Cellule « Auteur » | nom puis adresse en texte secondaire (« Système » pour une lecture de source ou une action automatique) | — | `actorName`, `actorEmail` |
| Cellule « Opération » | libellé français de l'API : « Déclaration », « Validation », « Validation en lot », « Retour pour complément », « Refus », « Annulation », « Saisie déclarée », « Ajout de justificatif », « Ouverture de justificatif », « Clôture mensuelle », « Gestion des accès », « Lecture de source », « Export paie », « Rapprochement PayFit » | Libellé tel quel ; type inconnu affiché tel quel | `operationLabel` |
| Cellule « Détail » | texte administratif en français, affiché en texte brut | Jamais de HTML interprété ; jamais de détail médical ni de nom de fichier de pièce privée | `summary` |
| Lien dossier | « Ouvrir le dossier » | Vers `/declarations/:id` | `absenceId` |
| Vide | « Aucune entrée dans le journal pour ces filtres. » | — | — |

## Règles
- `rule-evp-journal-readonly` (user) : le journal est en lecture seule (actions horodatées, auteur, opération, détail administratif) et réservé à RH et au superadmin.
- `rule-evp-journal-covers` (user) : y figurent chaque action de gestion des accès, les exports, les ouvertures de justificatifs, les décisions et les lectures de sources.
- `rule-evp-journal-no-medical` (user) : aucun document ni détail médical n'apparaît dans le journal.
- `rule-evp-journal-plain-text` (inferred) : détails affichés en texte brut, échappés (`Q-ECRANS-03`).
- `rule-evp-journal-pagination` (inferred) : pagination serveur comme `rule-foundation-list-pagination`, 25 par défaut.
- `rule-evp-journal-order` (inferred) : ordre fixe par date décroissante, non modifiable par le client.
- `rule-evp-journal-url-state` (inferred) : filtres portés par l'adresse.
- `rule-evp-journal-guard` (inferred) : sans la capacité `journal:read`, « Accès refusé » sans appel API.
- `rule-evp-journal-supersedes-foundation` (inferred) : sur `/journal`, la route du socle `GET /audit-logs` n'est plus appelée par le studio EVP ; l'écran du socle reste dans le dépôt, non lié.

## Accès
RH et superadmin (capacité `journal:read`). Les autres rôles : « Accès refusé » ; l'API répond `403`. L'administratrice n'a pas accès (« aucun droit d'export », pas de journal dans ses droits).

## Hypothèses
- Source des données : `base.audit_logs` (socle) lue par une route EVP dédiée qui joint les noms de comptes et traduit les opérations ; le socle gelé n'est pas modifié.
- L'écran du socle est remplacé dans la navigation EVP ; les onglets d'administration du socle ne sont plus présentés.
- Les connexions ne sont pas journalisées (la demande ne le réclame pas ; le socle exempte aussi la connexion par mot de passe). Les opérations « Déclaration », « Modification » (`PATCH`, sans écran) et « Rapprochement PayFit » (auteur « Système ») figurent dans le journal.
- Filtre par auteur ajouté en plus de l'opération et de la période (non demandé, utile à la lecture).
