# Couverture des règles : version v1-evp (EVP, préparation et suivi des absences, Micro-Stars)

Fichiers de tests de cette version (tous sous `acceptance/`, aide partagée `evp-helpers.ts`) :

| Sigle | Fichier |
|---|---|
| ACC | `acceptance-evp-access.test.ts` (état du service, connexion Google, session, droits, profil, paramètres, comptes d'accès) |
| CRE | `acceptance-evp-creches.test.ts` (crèches, contrats, clôtures, mois de paie) |
| ABS | `acceptance-evp-absences.test.ts` (types, déclaration, liste, détail, audit, à faire) |
| DEC | `acceptance-evp-decisions.test.ts` (table des transitions, soumettre, valider, lot, renvoyer, rejeter, annuler, marquer saisi, modification) |
| JUS | `acceptance-evp-justificatifs.test.ts` (autorisation d'envoi, confirmation, lien de lecture, nettoyage) |
| NJE | `acceptance-evp-notifications-journal-export.test.ts` |
| SRC | `acceptance-evp-sources.test.ts` (Sheets, PayFit, Aqoona, rapprochement, alertes) |
| RLS | `acceptance-evp-rls.test.ts` (sécurité au niveau des lignes sous le rôle `evp_app`) |
| ROL | `acceptance-evp-roles-contract.test.ts` (matrice rôle par rôle de toutes les routes, robustesse du contrat) |

Le titre de chaque test commence par le ou les identifiants de règle entre crochets. Pour retrouver les tests d'une règle : `jest -t "\[rule-evp-<slug>\]"`.

## Interface des doubles de test (spécification de QA)

Les sources externes et le stockage ne sont pas joignables en test. La recette définit donc les doubles suivants, que l'API doit honorer quand elle tourne avec `NODE_ENV=test` :

- **Fixtures des connecteurs** : dossier `api/.evp-fixtures-test/`, un fichier JSON par connecteur (`sheets.json`, `payfit.json`, `aqoona.json`). Les formats exacts sont ceux produits par `writeFixture`, `payfitFixture` et `PF` dans `acceptance/evp-helpers.ts` ; ce fichier en fait foi.
- **Journal des appels** : `api/.evp-fixtures-test/calls.log`, une ligne par appel sortant, au format `<connecteur>.<méthode>` (par exemple `payfit.listAbsences`). Aucune méthode d'écriture ne doit y figurer (verbes `create`, `update`, `delete`, `post`, `put`, `patch`, `write`, `push`, `send`).
- **Stockage des pièces** : dossier `api/.evp-storage-test/`. Les routes factices d'envoi (PUT) et de lecture (GET) vers lesquelles pointent les URL signées sont des routes cachées dont le chemin n'est pas spécifié : les tests ne lisent que l'URL rendue par l'API. Les assertions sur les octets stockés passent par `storageFilesContaining` (balayage du dossier à la recherche d'un marqueur).
- **Compte Système** : acteur des écritures automatiques, identifiant `00000000-0000-0000-0000-000000000000`, adresse `systeme@evp.invalid`.
- **Sessions** : les comptes EVP n'ont pas de mot de passe (connexion par mot de passe refusée). Les jetons sont forgés avec `JWT_SECRET` lu dans `api/.env.test`, à la forme d'un jeton socle réel ; les droits sont relus en base à chaque requête.

## Hypothèses retenues par la recette (à contester par un litige si elles gênent)

1. Les codes de types d'absence et leurs valeurs par défaut sont ceux amorcés par `seedWorld` (`AUTRE` existe, les autres suivent la demande).
2. Les noms de tables et de colonnes utilisés pour l'amorçage SQL sont ceux de l'aide `evp-helpers.ts`, déduits du plan du module.
3. Une absence est comptée en jours calendaires, bornes incluses ; l'étendue maximale de l'export est de 366 jours inclus.
4. Une demande bien formée mais contraire à un domaine métier répond `422` avec le code `invalid_domain` ; un corps mal formé répond `400`.
5. L'action `reconcile` fait partie des actions listées dans le journal ; les lots bloqués comportent des `blockages` par entrée.
6. Un dossier hors périmètre répond `404 repository.not_found`, identique octet pour octet à un dossier inconnu (aucune fuite d'existence).
7. L'`ADMINISTRATRICE` lit tout et n'écrit rien ; le `SUPERADMIN` porte le rôle socle `admin`.

## Limites connues du contrôleur de permissions

- Les comptes d'essai du contrôleur ne sont pas des comptes EVP : toute route protégée par un droit EVP y répond `403`. La matrice attendue (`specifications/permissions.yaml`) déclare donc `allow: []` pour ces routes ; la matrice rôle par rôle est prouvée par `acceptance-evp-roles-contract.test.ts`.
- `GET /google-sign-in/start` répond `503` si Google n'est pas configuré : le contrôleur peut y voir une erreur 5xx. La recette attend un service configuré (ou une redirection) en environnement de test ; sinon, ouvrir un litige.

## Règles du module : table de couverture

Légende : « Non observable » = aucune observation par l'API, HTTP ou SQL, ne peut prouver la règle ; la raison est donnée.

### Accès et authentification

| Rule id | Couverture |
|---|---|
| rule-evp-login-google-only | ACC (la connexion par mot de passe d'un compte EVP est refusée ; le parcours Google réussi n'est pas observable, voir plus bas) |
| rule-evp-login-domain-not-enough | ACC |
| rule-evp-login-service-status | ACC (`GET /service-status`, public) |
| rule-evp-login-single-denial | ACC (refus identique quel que soit le motif) |
| rule-evp-login-safe-redirect | ACC |
| rule-evp-login-no-secret-in-studio | ACC (aucun secret dans les réponses publiques) ; la partie « bundle du studio » est non observable par l'API (code du client) |
| rule-evp-login-public-no-hr-data | Non observable en tant que règle d'écran ; l'absence de donnée RH sur les routes publiques est vérifiée indirectement par les tests 401 anonymes de ROL |
| rule-evp-login-already-connected | Non observable par l'API : comportement de l'écran de connexion |
| rule-evp-session-8h | ACC (jeton de plus de 8 h refusé) |
| rule-evp-rights-rechecked | ACC, ROL (désactivation, retrait des crèches, changement de rôle pris en compte à la requête suivante) |
| rule-evp-rights-db-enforced | RLS |
| rule-evp-capabilities-list | ACC, ROL (ensemble exact des capacités par rôle) |
| rule-evp-account-inactive-logout | Couverte côté API par rule-evp-rights-rechecked (ACC) ; la déconnexion de l'écran est non observable par l'API |
| rule-evp-access-admin | ACC |
| rule-evp-access-who-manages | ACC, ROL |
| rule-evp-access-active-needs-creche | ACC |
| rule-evp-access-directrice-source | ACC |
| rule-evp-access-remove-ro | ACC |
| rule-evp-access-no-self-role | ACC |
| rule-evp-access-no-privileged | ACC |
| rule-evp-access-source-no-resurrect | SRC |
| rule-evp-access-audited | ACC |
| rule-evp-access-list-scope | ACC |
| rule-evp-access-pagination | ACC |
| rule-evp-access-domain | Pas de test dédié : exercée par les tests de rule-evp-login-domain-not-enough et de création de compte (ACC) |
| rule-evp-access-no-password | Pas de test dédié : exercée par les tests de rule-evp-login-google-only (ACC) |
| rule-evp-access-guard | Pas de test dédié : exercée par les tests de rule-evp-access-who-manages (ACC, ROL) |
| rule-evp-settings-no-secret | ACC |
| rule-evp-settings-payfit-disabled | ACC, ROL |
| rule-evp-settings-readonly | Non observable par l'API comme règle d'écran ; le contrat n'expose aucune route d'écriture de paramètres |
| rule-evp-settings-no-editor | Non observable par l'API : absence d'éditeur dans l'écran |
| rule-evp-settings-limits-visible | Non observable par l'API : affichage des limites à l'écran (les valeurs elles-mêmes sont servies par `GET /settings`, testé dans ACC) |
| rule-evp-settings-types-defaults | Non observable par l'API comme règle d'écran ; la règle serveur est rule-evp-declare-types-defaults (ABS, ROL) |
| rule-evp-settings-all-roles | Non observable par l'API comme règle d'écran ; l'accès de tous les rôles à `GET /settings` est dans ACC |
| rule-evp-settings-capability-sentences | Non observable par l'API : phrases de l'écran |
| rule-evp-no-store | ACC, ROL (`Cache-Control: no-store` sur les réponses privées) |
| rule-evp-foundation-admin-hidden | Non observable par l'API : navigation du studio |

### Crèches et clôtures

| Rule id | Couverture |
|---|---|
| rule-evp-creche-scope | CRE, ABS, ACC, ROL, SRC, RLS |
| rule-evp-creche-readonly | CRE, SRC (aucune écriture de crèche ni de contrat) |
| rule-evp-creche-link-siret | CRE, SRC |
| rule-evp-closure-attest | CRE |
| rule-evp-closure-open-blocks | CRE |
| rule-evp-closure-payroll-month | CRE |
| rule-evp-closure-api-roles | CRE, ROL |
| rule-evp-closure-audited | CRE |
| rule-evp-closure-no-reopen | CRE, RLS |
| rule-evp-closure-month-bounds | CRE |
| rule-evp-closure-visible | Non observable par l'API : affichage de l'état de clôture à l'écran (la donnée est servie par `GET /creches/{code}/closures`, testé dans CRE) |
| rule-evp-closure-month-choice | Non observable par l'API : sélecteur de mois de l'écran |

### Déclaration, cycle de vie, liste, détail, à faire

| Rule id | Couverture |
|---|---|
| rule-evp-declare-steps | ABS |
| rule-evp-declare-checks | ABS, DEC, SRC |
| rule-evp-declare-result-status | ABS |
| rule-evp-declare-duplicate | ABS, DEC |
| rule-evp-declare-overlap-blocks | ABS, SRC |
| rule-evp-declare-employee-key | ABS, CRE, SRC |
| rule-evp-declare-edit-server | DEC |
| rule-evp-declare-no-auto-anticipation | DEC |
| rule-evp-declare-roles | ABS, DEC, CRE, ROL, RLS |
| rule-evp-declare-no-medical-detail | ABS, DEC, ACC |
| rule-evp-declare-types-defaults | ABS, ROL |
| rule-evp-declare-max-pieces | ABS, JUS, ROL |
| rule-evp-declare-comment-bound | ABS, DEC, ROL |
| rule-evp-declare-half-day-order | ABS, DEC |
| rule-evp-declare-validation-local | Non observable par l'API : validation locale du formulaire (le serveur revalide, voir rule-evp-declare-checks) |
| rule-evp-decision-states | ABS, DEC, NJE |
| rule-evp-decision-marine-only | ABS, DEC, ROL |
| rule-evp-decision-reason-required | DEC |
| rule-evp-decision-replay-controls | DEC |
| rule-evp-batch-individual-controls | DEC |
| rule-evp-batch-max-50 | DEC, ROL |
| rule-evp-batch-validate-rh-only | Pas de test dédié : exercée par les tests de rule-evp-decision-marine-only et rule-evp-batch-individual-controls (DEC, ROL) |
| rule-evp-cancel-scope | DEC, ROL |
| rule-evp-mark-entered-no-proof | DEC, SRC |
| rule-evp-payfit-no-manual-confirm | ABS, DEC, SRC |
| rule-evp-arbitrage-rh | ABS, SRC |
| rule-evp-validated-is-to-enter | DEC |
| rule-evp-validate-is-not-transmit | Pas de test dédié : exercée par les tests de rule-evp-validated-is-to-enter (DEC) et de rule-evp-export-no-payfit-write (NJE, `calls.log`) |
| rule-evp-detail-actions-from-api | ABS, DEC |
| rule-evp-detail-private-piece | JUS |
| rule-evp-detail-404-indistinct | ABS (test `[rule-evp-list-scope] a dossier outside the perimeter answers 404 repository.not_found, byte for byte…`) |
| rule-evp-detail-four-questions | Non observable par l'API : présentation de l'écran |
| rule-evp-detail-content | Non observable par l'API comme règle d'écran ; le contenu du détail servi par l'API est dans ABS |
| rule-evp-detail-no-general-edit | Non observable par l'API : absence de bouton de modification générale (la modification serveur est dans DEC) |
| rule-evp-detail-conflict-refresh | Non observable par l'API : rafraîchissement de l'écran après un conflit (le `409` lui-même est dans DEC) |
| rule-evp-list-scope | ABS, DEC, ROL |
| rule-evp-list-max-200 | ABS |
| rule-evp-list-filters | Non observable par l'API comme règle d'écran ; les filtres serveur sont exercés dans ABS |
| rule-evp-list-create-by-role | Non observable par l'API : bouton de création de l'écran (le droit de créer par rôle est dans ABS, ROL) |
| rule-evp-list-status-labelled | Non observable par l'API : libellés d'état à l'écran |
| rule-evp-list-url-state | Non observable par l'API : état dans l'URL |
| rule-evp-list-empty | Non observable par l'API : état vide de l'écran |
| rule-evp-list-employee-key | Non observable par l'API comme règle d'écran ; la clé salarié est dans ABS |
| rule-evp-todo-counter-definition | ABS, ROL |
| rule-evp-todo-priority-order | ABS |
| rule-evp-todo-role-counters | Pas de test dédié : exercée par les tests de rule-evp-todo-counter-definition (ABS, ROL) |
| rule-evp-todo-read-notification-no-effect | Pas de test dédié : exercée par les tests de rule-evp-notification-read-no-effect (NJE) |
| rule-evp-todo-empty-state | Non observable par l'API : état vide de l'écran |
| rule-evp-audit-atomic | ABS, DEC, JUS, ROL, RLS (journal chronologique du dossier écrit dans la même transaction, immuable) ; l'annulation d'une transaction par injection de panne n'est pas observable par l'API |

### Justificatifs

| Rule id | Couverture |
|---|---|
| rule-evp-attach-formats | JUS, ACC |
| rule-evp-attach-temp-upload | JUS |
| rule-evp-attach-copy-out | JUS |
| rule-evp-attach-no-files-in-db | JUS |
| rule-evp-attach-attached-on-confirm | JUS, ABS |
| rule-evp-attach-single-confirm | JUS |
| rule-evp-piece-read-link | JUS |
| rule-evp-piece-open-audited | JUS |
| rule-evp-piece-no-medical-in-logs | JUS |
| rule-evp-piece-scope | JUS, ROL |
| rule-evp-piece-unattached-cleanup | JUS |

### Notifications, journal, export

| Rule id | Couverture |
|---|---|
| rule-evp-notif-list | NJE |
| rule-evp-notif-max-100 | NJE |
| rule-evp-notif-read-decides-nothing | NJE, SRC |
| rule-evp-notification-read-no-effect | NJE |
| rule-evp-notif-per-user-read | NJE, RLS |
| rule-evp-notif-scope | NJE, ROL |
| rule-evp-notif-created-with-proof | SRC |
| rule-evp-notif-no-medical | SRC |
| rule-evp-notif-read-not-journaled | NJE |
| rule-evp-notif-open-not-read | Non observable par l'API : ouvrir une notification à l'écran sans la marquer lue (l'API n'a pas d'effet d'ouverture) |
| rule-evp-notif-text-from-api | Non observable par l'API : texte rendu par l'écran |
| rule-evp-unread-badge-refresh | Non observable par l'API : rafraîchissement du badge (le compteur est dans NJE) |
| rule-evp-journal-readonly | NJE, ROL |
| rule-evp-journal-covers | NJE |
| rule-evp-journal-no-medical | NJE, JUS |
| rule-evp-journal-source | NJE, SRC |
| rule-evp-journal-pagination | NJE |
| rule-evp-journal-order | Pas de test dédié : exercée par les tests de rule-evp-journal-pagination (NJE) |
| rule-evp-journal-guard | Pas de test dédié : exercée par les tests de rule-evp-journal-readonly (NJE, ROL) |
| rule-evp-journal-plain-text | Non observable par l'API : rendu en texte brut de l'écran |
| rule-evp-journal-url-state | Non observable par l'API : état dans l'URL |
| rule-evp-journal-supersedes-foundation | Non observable par l'API comme règle propre ; `GET /audit-logs` du socle n'est pas modifié |
| rule-evp-export-roles | NJE, ROL |
| rule-evp-export-period | NJE |
| rule-evp-export-columns | NJE |
| rule-evp-export-csv-format | NJE, ROL |
| rule-evp-export-all-statuses | NJE |
| rule-evp-export-audited | NJE |
| rule-evp-export-no-payfit-write | NJE |
| rule-evp-export-post-for-audit | NJE |
| rule-evp-export-max-span | NJE |
| rule-evp-export-no-file-kept | Non observable par l'API : la conservation éventuelle d'un fichier côté serveur n'a pas d'emplacement spécifié à inspecter |

### Sources et rapprochement PayFit

| Rule id | Couverture |
|---|---|
| rule-evp-sources-readonly | SRC |
| rule-evp-sources-workspace-scope | SRC |
| rule-evp-sources-sheets | SRC |
| rule-evp-sources-sheets-superadmin | SRC, ROL |
| rule-evp-sources-payfit | SRC |
| rule-evp-sources-aqoona | SRC |
| rule-evp-sources-nir-discarded | SRC |
| rule-evp-sources-manual | SRC, ROL |
| rule-evp-sources-links | SRC |
| rule-evp-sources-no-invention | SRC |
| rule-evp-sources-no-auto-absence | SRC |
| rule-evp-sources-ro-gaps-not-overwritten | SRC |
| rule-evp-sources-credentials | SRC, ACC (aucun identifiant dans les réponses) ; le stockage des identifiants en configuration d'environnement n'est pas observable par l'API |
| rule-evp-sources-run-single | SRC |
| rule-evp-sources-refresh-audited | SRC |
| rule-evp-sources-guard | Pas de test dédié : exercée par les tests de rule-evp-sources-manual et rule-evp-sources-sheets-superadmin (SRC, ROL) |
| rule-evp-sources-payfit-aqoona-manual | Pas de test dédié : exercée par les tests de rule-evp-sources-manual (SRC, ROL) |
| rule-evp-sources-screen | Non observable par l'API : présentation de l'écran |
| rule-evp-sources-windows | Non observable par l'API comme règle d'écran (affichage des fenêtres) ; les observations de PayFit utilisées dans SRC restent dans la fenêtre M-2 à M+2 |
| rule-evp-sources-run-polling | Non observable par l'API : cadence d'interrogation de l'écran ; `GET /sources/runs/{id}` est exercée dans SRC au titre de rule-evp-sources-run-single |
| rule-evp-payfit-proof | SRC |
| rule-evp-payfit-atomic-confirmation | SRC ; l'atomicité sous panne injectée n'est pas observable par l'API |
| rule-evp-payfit-alerts | SRC, RLS |

### Mise en page, PWA, thème

| Rule id | Couverture |
|---|---|
| rule-evp-layout-sidebar | Non observable par l'API : écran |
| rule-evp-layout-account-visible | Non observable par l'API : écran |
| rule-evp-layout-payfit-warning | Non observable par l'API : écran (le drapeau `payfit` est servi par `GET /settings`, testé dans ACC) |
| rule-evp-layout-nav-by-capability | Non observable par l'API : navigation du studio (les capacités sont servies par `GET /profile`, testé dans ACC et ROL) |
| rule-evp-layout-theme-tokens | Non observable par l'API : thème |
| rule-evp-layout-focus-motion | Non observable par l'API : accessibilité visuelle |
| rule-evp-layout-six-states | Non observable par l'API : états d'écran |
| rule-evp-layout-status-not-color-only | Non observable par l'API : accessibilité visuelle |
| rule-evp-layout-four-questions | Non observable par l'API : présentation |
| rule-evp-pwa-installable | Non observable par l'API : manifeste et service worker du studio |
| rule-evp-pwa-no-offline-data | Non observable par l'API : cache du client (côté serveur, `no-store` est dans ACC et ROL) |

## Justifications « not observable » (format lu par la matrice de complétude)

La matrice (`.cuisine/scripts/matrix-check.sh`) cherche, sur une même ligne, l'identifiant de la règle puis l'expression anglaise « not observable ». Les règles ci-dessous ne concernent que des écrans du studio : la suite de recette (HTTP + SQL) ne peut pas les observer, et aucun test navigateur n'existe encore pour elles. Les règles dont une part est observable par l'API sont couvertes par les tests de `acceptance-evp-completeness.test.ts` (sigle CPL) ou par les fichiers cités plus haut.

| Rule id | Justification |
|---|---|
| rule-evp-login-public-no-hr-data | not observable as a screen rule: the login screen displays nothing from the API but `GET /service-status`, tested in ACC |
| rule-evp-login-already-connected | not observable by the API: redirection of the login screen for a signed-in visitor |
| rule-evp-closure-visible | not observable by the API: display of the closure state (data served by `GET /creches/{code}/closures`, tested in CRE) |
| rule-evp-closure-month-choice | not observable by the API: month selector of the screen |
| rule-evp-declare-validation-local | not observable by the API: local validation of the form (the server revalidates, see rule-evp-declare-checks) |
| rule-evp-detail-four-questions | not observable by the API: presentation of the detail screen |
| rule-evp-detail-content | not observable by the API as a screen rule: content of the detail screen (the payload is tested in ABS) |
| rule-evp-detail-no-general-edit | not observable by the API: absence of a general edit button in the screen |
| rule-evp-detail-conflict-refresh | not observable by the API: refresh of the screen after a conflict (the 409 itself is tested in DEC) |
| rule-evp-export-no-file-kept | not observable by the API: no location of a kept file is specified, so no file can be inspected |
| rule-evp-foundation-admin-hidden | not observable by the API: navigation of the studio |
| rule-evp-journal-plain-text | not observable by the API: plain-text rendering of the screen |
| rule-evp-journal-supersedes-foundation | not observable by the API as an own rule: `GET /audit-logs` of the foundation is unchanged |
| rule-evp-journal-url-state | not observable by the API: state kept in the URL of the screen |
| rule-evp-layout-sidebar | not observable by the API: screen layout |
| rule-evp-layout-account-visible | not observable by the API: screen layout |
| rule-evp-layout-payfit-warning | not observable by the API: screen banner (the `payfit` flag is served by `GET /settings`, tested in ACC) |
| rule-evp-layout-nav-by-capability | not observable by the API: navigation of the studio (capabilities are served by `GET /profile`, tested in ACC and ROL) |
| rule-evp-layout-theme-tokens | not observable by the API: theme |
| rule-evp-layout-focus-motion | not observable by the API: visual accessibility |
| rule-evp-layout-six-states | not observable by the API: screen states |
| rule-evp-layout-status-not-color-only | not observable by the API: visual accessibility |
| rule-evp-layout-four-questions | not observable by the API: presentation |
| rule-evp-list-create-by-role | not observable by the API: creation button of the screen (the right to create per role is tested in ABS and ROL) |
| rule-evp-list-employee-key | not observable by the API as a screen rule: the employee key is tested in ABS |
| rule-evp-list-empty | not observable by the API: empty state of the screen |
| rule-evp-list-filters | not observable by the API as a screen rule: the server filters are tested in ABS |
| rule-evp-list-status-labelled | not observable by the API: status labels of the screen |
| rule-evp-list-url-state | not observable by the API: state kept in the URL of the screen |
| rule-evp-notif-open-not-read | not observable by the API: opening a notification in the screen (the API has no opening effect) |
| rule-evp-notif-text-from-api | not observable by the API: text rendered by the screen |
| rule-evp-unread-badge-refresh | not observable by the API: refresh of the badge (the counter is tested in NJE) |
| rule-evp-pwa-installable | not observable by the API: manifest and service worker of the studio |
| rule-evp-pwa-no-offline-data | not observable by the API: client cache (server side, `no-store` is tested in ACC and ROL) |
| rule-evp-settings-readonly | not observable by the API as a screen rule: the contract exposes no write route for settings |
| rule-evp-settings-no-editor | not observable by the API: no editor in the screen |
| rule-evp-settings-limits-visible | not observable by the API: display of the limits (the values are served by `GET /settings`, tested in ACC) |
| rule-evp-settings-types-defaults | not observable by the API as a screen rule: the server rule is rule-evp-declare-types-defaults (ABS, ROL) |
| rule-evp-settings-all-roles | not observable by the API as a screen rule: access of every role to `GET /settings` is tested in ACC |
| rule-evp-settings-capability-sentences | not observable by the API: sentences of the screen |
| rule-evp-sources-screen | not observable by the API: presentation of the screen |
| rule-evp-sources-windows | not observable by the API as a screen rule: display of the windows (the windows themselves are tested in SRC) |
| rule-evp-sources-run-polling | not observable by the API: polling cadence of the screen (`GET /sources/runs/{id}` is tested in SRC) |
| rule-evp-todo-empty-state | not observable by the API: empty state of the screen |

Règles rendues observables par `acceptance-evp-completeness.test.ts` (sigle CPL, titres entre crochets) : rule-evp-access-domain, rule-evp-access-no-password, rule-evp-access-guard, rule-evp-account-inactive-logout (côté API), rule-evp-batch-validate-rh-only, rule-evp-validate-is-not-transmit, rule-evp-detail-404-indistinct, rule-evp-todo-role-counters, rule-evp-todo-read-notification-no-effect, rule-evp-journal-order, rule-evp-journal-guard, rule-evp-sources-guard, rule-evp-sources-payfit-aqoona-manual.

## Autres éléments non observables par l'API

- Succès du retour Google (`/google-sign-in/callback`) : exige un vrai fournisseur Google ; seuls les refus (état, domaine, compte inconnu ou inactif, redirection) sont testés.
- État du service quand la base est injoignable : non reproductible sans couper la base.
- Fraîcheur des observations PayFit : le plan ne fournit pas d'horloge injectable ; seule la présence d'une observation récente est exercée.
- Absence de planificateur (aucun rafraîchissement automatique) : non observable ; seules les exécutions déclenchées explicitement sont testées.
