# Couverture des règles : version v2-evp-sources (EVP, connexion Google vérifiée et lectures réelles des sources)

Version suivante de `v1-evp`. Tests écrits avant tout code, d'après la demande d'origine, les deux demandes à l'API (`google-sign-in-api-modification-request.md`, `sources-api-modification-request.md`), les plans de module et d'écran de `specifications/evp/implementation-plans/v2-evp-sources/` et les décisions actives de `specifications/evp/arbitrages.yaml`. Les tests de la v1 ne sont pas modifiés.

| Sigle | Fichier |
|---|---|
| GOO | `acceptance-v2-google-sign-in.test.ts` (démarrage du flux, contrôles du jeton d'identité, clés publiques, comptes et `sub`) |
| SHE | `acceptance-v2-sources-sheets.test.ts` (Google Sheets API v4, compte de service) |
| PAY | `acceptance-v2-sources-payfit.test.ts` (PayFit : introspection, ressources, erreurs, lectures partielles, demi-journées, statuts, types) |
| AQO | `acceptance-v2-sources-aqoona.test.ts` (adresses Aqoona, correspondance, fenêtre, formats, erreurs, lectures partielles) |
| STA | `acceptance-v2-sources-state.test.ts` (`GET /sources`, exécutions, « Toutes les sources », contrat OpenAPI) |
| UNC | `acceptance-v2-unconfigured.test.ts` (variante d'API « non configurée », voir plus bas) |

Aides partagées : `v2-helpers.ts` (serveurs factices, jetons Google, lecture de l'environnement de l'API de test). Fichiers de configuration de recette : `fixtures/payfit-absence-types.test.json`, `fixtures/aqoona-mapping.test.json`.

Le titre de chaque test commence par le ou les identifiants de règle entre crochets, puis, pour les décisions du propriétaire, `[D-xxxx]`. Pour retrouver les tests d'une règle : `jest -t "\[rule-evp-<slug>\]"`.

## Interface des doubles de test (v2) : ce que la cuisine doit fournir

L'API de test est un processus distinct des tests : ses variables sont fixées à son démarrage. Les tests **lisent** `api/.env.test` (ou le fichier désigné par la variable `ACCEPTANCE_ENV_FILE`, qui doit être celui de l'API sous test), **démarrent eux-mêmes** les serveurs HTTP factices sur les adresses locales fixes qui y sont déclarées, et font varier le comportement de ces serveurs, jamais la configuration. Si une variable obligatoire manque, le test échoue en la nommant.

Pour l'API de test « standard » (`EVP_SOURCES_DRIVER=real`), `api/.env.test` doit déclarer :

| Variable | Valeur attendue |
|---|---|
| `EVP_SOURCES_DRIVER` | `real` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | valeurs de test factices |
| `GOOGLE_PUBLIC_ORIGIN` (ou `GOOGLE_REDIRECT_URI`) | origine locale de l'API de test |
| `GOOGLE_ALLOWED_DOMAIN` | absente (défaut `micro-stars.fr`) ou `micro-stars.fr` |
| `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_CERTS_URL` | `http://127.0.0.1:<port fixe>/<chemin>` ; les trois sur un même port ou non, mais avec des chemins distincts |
| `SHEETS_BASE_URL`, `SHEETS_TOKEN_URL` | adresses locales fixes (chemins distincts de ceux de Google si le port est partagé) ; `SHEETS_TOKEN_URL` peut être omise (alors égale à `GOOGLE_TOKEN_URL`, mais les fichiers de tests ne démarrent jamais ensemble les deux serveurs) |
| `SHEETS_SPREADSHEET_ID`, `SHEETS_CLIENT_EMAIL` | valeurs de test factices ; `SHEETS_TAB_NAME` et `SHEETS_RANGE` absentes (défauts) ou aux valeurs par défaut |
| `SHEETS_PRIVATE_KEY` | clé privée RSA PEM **de test** (retours à la ligne écrits `\n`), jamais une vraie clé |
| `PAYFIT_BASE_URL`, `PAYFIT_INTROSPECT_URL` | adresses locales fixes, chemins distincts |
| `PAYFIT_API_KEYS` | JSON de deux entrées au moins : `{ "siret": "11111111111111", "apiKey": "…" }` et `{ "siret": "22222222222222", "apiKey": "…" }` (les SIRET de `seedWorld()`), clés factices d'au moins 8 caractères et différentes |
| `PAYFIT_RETRY_DELAY_MS` | petite valeur (par exemple `200`) pour garder la recette courte |
| `PAYFIT_ABSENCE_TYPES_FILE` | `acceptance/fixtures/payfit-absence-types.test.json` (chemin absolu, ou relatif à `api/` ou à la racine) |
| `AQOONA_URLS` | JSON de deux entrées au moins, `http://127.0.0.1:<port fixe>/<chemin distinct par entrée>?<jeton factice>` ; la première avec un `label`, la seconde sans (elle reçoit `Adresse 2`) |
| `AQOONA_MAPPING_FILE` | `acceptance/fixtures/aqoona-mapping.test.json` |

`JWT_SECRET` et `COOKIE_SECRET` doivent être ceux que lisent déjà les aides de la v1 (jetons forgés).

**Deux API de test, deux pilotes** (décision D-0003). Les tests de la v1 tournent contre l'API lancée avec `EVP_SOURCES_DRIVER=fake` ; les tests « standard » de la v2 contre l'API `real` ci-dessus. Les fichiers `acceptance-v2-*` hors UNC passent sous `describe.skip` quand `ACCEPTANCE_VARIANT` est défini ; UNC ne s'exécute que si `ACCEPTANCE_VARIANT=unconfigured`.

**Variante « non configurée »** (`ACCEPTANCE_VARIANT=unconfigured jest acceptance-v2-unconfigured.test.ts`) : une troisième API de test lancée avec `EVP_SOURCES_DRIVER=real` **sans** `GOOGLE_CLIENT_SECRET`, `SHEETS_PRIVATE_KEY`, `SHEETS_SPREADSHEET_ID`, `PAYFIT_API_KEYS` ni `AQOONA_URLS`. Elle prouve `google_not_configured`, le `503` de `start`, l'état `UNAVAILABLE` et `sources.not_configured` (D-0003) sans repli sur les fixtures de la v1.

Exécution : `jest --runInBand` (script `test` de `acceptance/package.json`). Les serveurs factices tentent d'écouter pendant 90 s si un port est encore occupé par le fichier précédent. Durée : la recette comporte des attentes réelles (délai de 10 s de Google, délai de 30 s par appel de source, une attente de 61 s avant l'unique test de rotation des clés, qui est limité à une relecture forcée par minute) : compter une dizaine de minutes pour les fichiers standard.

## Hypothèses retenues par la recette (à contester par un litige si elles gênent)

1. **Enveloppes de PayFit** (documentation officielle, non reprises mot pour mot par la demande) : `GET /companies/{id}/collaborators` répond `{ meta: { nextPageToken }, collaborators: […] }`, `…/contracts-fr` répond `{ meta, contracts: […] }`, `…/absences` répond `{ meta, absences: […] }` ; `GET /companies-fr/{id}` répond un objet avec `identificationNumber` (le champ `siret` du faux serveur est un leurre à valeur fausse) et facultativement `name` ; l'introspection répond `{ active, company_id, … }`. Le faux PayFit refuse `maxResults` > 50 (400) et, sans `status=all`, ne renvoie que les absences `approved`.
2. **Messages d'erreur PayFit** : échec total d'un code 401 → message contenant « Clé PayFit refusée », 403 → « Portée PayFit manquante », 404 de société → « introuvable » (règle `rule-evp-payfit-errors`) ; détail des anomalies « Société inaccessible » en lecture partielle : « Clé refusée pour une société », « Portée PayFit manquante », « Société introuvable » (règle `rule-evp-sources-partial-failure`).
3. **Tables internes lues par SQL** (noms de la demande et du plan de module, hors `data-contract.md`) : `evp_accounts.google_sub` ; `payfit_coverage(company_id, reachable, exhaustive)` ; `payfit_contracts.status` ; `payfit_absences(company_id, status, start_half, end_half, payfit_absence_id)` ; `payfit_proofs.source_status` ; `payfit_employees(company_id, employee_id, last_name)` ; `aqoona_plannings(person_ref, creche_code, day)` ; `source_runs`, `source_anomalies`, `audit_logs`.
4. **Fichiers de configuration relus à chaque lecture** : les tests qui remplacent temporairement `PAYFIT_ABSENCE_TYPES_FILE` ou `AQOONA_MAPPING_FILE` (fichier invalide, second format de jour) supposent que la lecture charge le fichier à chaque fois (`evpConfig()` « n'est pas figé à l'import »). Le fichier est restauré à la fin de chaque test.
5. **Sheets** : une ligne par crèche avec une seule RO (colonnes « RO nom », « RO e-mail »). Un jeton d'accès de `expires_in` 60 n'est jamais réutilisé (TTL = `expires_in` − 60 s).
6. **Aqoona** : le format du JSON est inconnu ; les tests s'appuient sur le fichier de correspondance de la recette (enregistrements sous `planning.items`, champs imbriqués, `YYYY-MM-DD`, `HH:mm`) et sur une variante à la racine (`DD/MM/YYYY`, `HH:mm:ss`), pas sur le fichier provisoire livré. Le seuil « plus de la moitié » est mesuré par adresse.
7. **Notifications** : types `CONFIRMATION`, `MODIFICATION`, `ANNULATION`, `DISPARITION`, `RESTAURATION` (v1).
8. **Délais** : l'échange du code et la lecture des clés Google se terminent par `echec` en moins de 25 s (règle de 10 s) ; un appel de source muet dure au moins 25 s avant d'échouer (règle de 30 s).
9. **Plannings Aqoona d'une adresse relue** : remplacés par ceux de la nouvelle lecture de cette adresse ; ceux d'une adresse en échec sont conservés.

## Décisions actives (une épreuve par décision observable)

| Décision | Question | Choix | Épreuve (titre) |
|---|---|---|---|
| D-0002 | Q-EVP-03 | A (aucune alerte tant que `cancelled` n'est pas acté) | PAY `[rule-evp-payfit-pending-cancellation][D-0002]` |
| D-0003 | Q-EVP-06 | A (interrupteur global) | UNC `[rule-evp-sources-configurable][D-0003]` |
| D-0004 | Q-EVP-08 | A (ligne écartée et comptée) | AQO `[rule-evp-aqoona-unexpected-format][D-0004]` |
| D-0005 | Q-EVP-01 | A (redirection serveur avec code) | GOO et STA `[rule-evp-google-flow-redirect][D-0005]` |
| D-0006 | Q-EVP-02 | A (lecture selon la position) | PAY `[rule-evp-payfit-half-day-mapping][D-0006]` |
| D-0007 | Q-EVP-04 | B (lecture partielle) | PAY et AQO `[rule-evp-sources-partial-failure][D-0007]` |
| D-0008 | Q-EVP-05 | A (refus, liaison inchangée) | GOO `[rule-evp-google-sub-mismatch][D-0008]` |
| D-0009 | Q-EVP-07 | A (compte de service, JWT-bearer) | SHE `[rule-evp-sheets-service-account][D-0009]` |

## Règles de la version : table de couverture

Légende : « Non observable » = aucune observation par l'API, HTTP ou SQL, ne peut prouver la règle ; la raison est donnée. « Test unitaire » = prévu par la section « Tests » du plan de module (tests unitaires du développeur sans API), non observable en boîte noire.

### Connexion Google

| Rule id | Couverture |
|---|---|
| rule-evp-google-token-verified-server | GOO (jeton servi par Google à l'échange du code ; `id_token` ou `credential` fournis par le navigateur ignorés ; charge utile altérée refusée ; aucun appel sortant au démarrage ni par `service-status`), UNC |
| rule-evp-google-signature | GOO (autre clé de même `kid`, charge utile altérée, `alg` `none` avec et sans point final, HS256) |
| rule-evp-google-certs-cache | GOO (`max-age` respecté puis relecture ; sans `max-age` ou `no-cache` : pas de cache). Le repli sans `max-age` est (inferred) |
| rule-evp-google-certs-rotation | GOO (un `kid` inconnu provoque une relecture et la clé tournée est acceptée ; pas de seconde relecture forcée dans la minute) |
| rule-evp-google-certs-fail-closed | GOO (clés en 500, non JSON, sans liste ; cache expiré non réutilisé quand la relecture échoue) |
| rule-evp-google-aud | GOO |
| rule-evp-google-iss | GOO (les deux formes acceptées ; autre hôte, hôte approchant, http, absent refusés) |
| rule-evp-google-exp | GOO (expiré au-delà de 60 s refusé ; dans la tolérance accepté ; absent refusé) |
| rule-evp-google-hd | GOO (absent, autre, approchant : `erreur=domaine` même si l'adresse finit par le domaine ; casse différente acceptée) |
| rule-evp-google-email-verified | GOO (faux et absent refusés) |
| rule-evp-google-domain-configurable | GOO (`hd` de `start` = domaine configuré). Un autre domaine configuré n'est pas rejouable : la configuration est fixée au démarrage de l'API de test |
| rule-evp-google-endpoints-configurable | GOO (`start` vers `GOOGLE_AUTH_URL`, échange sur `GOOGLE_TOKEN_URL`, clés sur `GOOGLE_CERTS_URL`), UNC (aucune valeur de substitution : `google_not_configured`, `503`) |
| rule-evp-google-flow-redirect | GOO (`state`, `nonce`, PKCE S256 vérifié à l'échange, cookie de flux, `redirect_uri`, jeton lu dans la réponse de Google, `nonce` comparé), STA (D-0005 : `POST /google-sign-in/credential` absent du contrat). Expiration du cookie de 10 minutes : non observable (attente de 10 minutes ; le cookie absent est testé) |
| rule-evp-google-sub-identity | GOO (recherche par `sub` avant l'adresse) |
| rule-evp-google-sub-binding | GOO (liaison à la première connexion, adresse insensible à la casse, concurrence de deux connexions, bornes 1..255 du `sub`) |
| rule-evp-google-sub-mismatch | GOO (D-0008) |
| rule-evp-google-sub-email-change | GOO (adresse administrée inchangée) |
| rule-evp-google-sub-unique | GOO (refus de la base pour un doublon ; `sub` déjà lié à un autre compte) |
| rule-evp-login-domain-not-enough | GOO (absent, inactif, retiré, sans crèche : mêmes refus ; session limitée au périmètre du compte) |
| rule-evp-login-single-denial | GOO (adresse de redirection identique pour toutes les causes, aucun indice) |
| rule-evp-session-8h | GOO (revendications `exp - iat` = 8 h, `Max-Age` si présent ; accès relu depuis le compte) |
| rule-evp-google-error-causes | GOO (`annule`, `domaine`, `non_autorise`, `echec` ; échange refusé, sans `id_token`, jeton illisible, clés injoignables, délai de 10 s) |
| rule-evp-google-scopes-minimal | GOO (`openid email profile` seulement) |
| rule-evp-google-sign-in-audit | GOO (une entrée « Liaison Google enregistrée », auteur Système, objet « Accès », sans `sub`, pas de seconde entrée à la connexion suivante) |
| rule-evp-google-csrf-double-submit | Sans objet, not observable : l'option B de Q-EVP-01 n'est pas retenue (D-0005) ; la route `POST /google-sign-in/credential` n'existe pas, donc aucun double envoi de jeton CSRF à observer (son absence est vérifiée par GOO, STA) |
| rule-evp-secrets-never-exposed | GOO (adresses de redirection, audit, journal du serveur), SHE, PAY, AQO (réponses, `lastError`, `errorMessage`, anomalies, audit, notifications, export CSV, vidages de tables, journal du serveur `api/.server-test.log`), STA. `redactSecrets()` : test unitaire |

### Sources, commun

| Rule id | Couverture |
|---|---|
| rule-evp-sources-readonly | SHE, PAY, AQO (seuls des `GET` ; `POST` seulement vers le jeton du compte de service et l'introspection). Absence de `PUT`/`PATCH`/`DELETE` dans le code : test unitaire |
| rule-evp-sources-configurable | UNC (D-0003 : `real` sans configuration → `sources.not_configured`, aucun repli sur les fixtures), SHE, PAY, AQO (adresses de base, identifiants et secrets pris dans l'environnement). Régression de la v1 sous `fake` : suite de la v1 lancée contre l'API `fake`, pas un test nouveau |
| rule-evp-sources-failure-state | SHE, PAY, AQO, STA, UNC (état `ERROR`/`UNAVAILABLE`, `lastReadAt` et volumes du dernier succès conservés, rien de copié) |
| rule-evp-sources-error-codes | SHE (400, 401, 403, 404, 429, 5xx, non JSON), PAY (401, 403, 404, 429, 5xx, introspection sans `company_id`, jeton cyclique), AQO (401, 403, 404, 429, 5xx, non JSON, enregistrements), STA, UNC |
| rule-evp-sources-timeouts | SHE, PAY, AQO (délai de 30 s, essais au plus au nombre de 3 sur 429 et 5xx, aucun sur 4xx) |
| rule-evp-sources-run-single | STA (`409 sources.run_in_progress`, une autre source reste lisible), v1 |
| rule-evp-sources-refresh-audited | PAY, STA (une entrée par lecture lancée, sans adresse ni clé), AQO |
| rule-evp-sources-no-scheduler | SHE, STA (aucune lecture ni appel sortant sans action humaine, après une attente). Absence de `@Cron`/`setInterval` : test unitaire |
| rule-evp-sources-partial-failure | PAY (D-0007, causes, pagination interrompue, SIRET différent, délai), AQO (D-0007), STA (« Toutes les sources » continue après `PARTIAL`, s'arrête à `FAILED`) |
| rule-evp-sources-manual | SHE, PAY, AQO, STA (RH et superadmin ; autres 403 ; anonyme 401 ; aucun appel sortant pour un refus) |
| rule-evp-sources-sheets-superadmin | SHE, STA, UNC (Sheets au superadmin seul, avant PayFit et Aqoona, enchaînement arrêté au premier échec) |
| rule-evp-sources-workspace-scope | UNC (404 de `workspace`), v1 |

### Google Sheets

| Rule id | Couverture |
|---|---|
| rule-evp-sheets-values-get | SHE (un `GET`, chemin et plage `'Contacts des crèches'!A:G` encodés, classeur configuré) |
| rule-evp-sheets-scope-readonly | SHE (portée de l'assertion = `spreadsheets.readonly` et elle seule) |
| rule-evp-sheets-configurable | SHE (identifiant, onglet, plage, compte lus dans l'environnement). Un autre onglet ou une autre plage ne sont pas rejouables (configuration fixée au démarrage) |
| rule-evp-sheets-service-account | SHE (D-0009 : `grant_type` JWT-bearer, assertion RS256 de signature valide ; jeton mis en cache jusqu'à `expires_in` − 60 s) |
| rule-evp-sheets-columns | SHE (nom, code, SIRET en texte avec zéro initial, adresse de connexion, directrice, RO nom, RO e-mail) |
| rule-evp-sheets-header-driven | SHE (ordre différent, casse, colonne en plus ; un intitulé manquant → `sources.unexpected_format`, pour chacun des sept) |
| rule-evp-sheets-formatted-values | SHE (`valueRenderOption=FORMATTED_VALUE`, `majorDimension=ROWS` ; réponse sans `values` = plage vide) |
| rule-evp-sources-sheets | SHE (référentiel, crèche créée avec périmètre et groupes, code normalisé), v1 |
| rule-evp-sources-ro-gaps-not-overwritten | SHE (écart RO = anomalie, aucun compte ni affectation modifiés), v1 |
| rule-evp-creche-readonly, rule-evp-creche-scope | SHE (référentiel construit, invariants des affectations), v1 |

### PayFit

| Rule id | Couverture |
|---|---|
| rule-evp-payfit-bearer | PAY (introspection et chaque `GET` avec la clé de la société concernée) |
| rule-evp-payfit-company-id | PAY (`POST` avec Bearer et `{"token": clé}` ; `company_id` conservé, jamais ré-introspecté ; réponse sans `company_id` → `sources.unexpected_format`). Réintrospection quand la clé change : non observable en boîte noire (empreinte interne, `(inferred)`), test unitaire |
| rule-evp-payfit-scopes | PAY (aucune requête ne contient `time:write`, aucune écriture). Les portées sont attachées à la clé, pas demandées par le code : test unitaire du code des clients |
| rule-evp-payfit-company | PAY (chemin exact ; `identificationNumber` et non `siret` ; nom de repli = SIRET) |
| rule-evp-payfit-collaborators | PAY (chemin exact, société du chemin, mêmes identifiants dans deux sociétés) |
| rule-evp-payfit-contracts | PAY (chemin exact, nom pris sur la collaboratrice et non sur les champs dépréciés du contrat) |
| rule-evp-payfit-contracts-all-statuses | PAY (`ACTIVE`, `ARCHIVED`, `PENDING` conservés, un contrat archivé reste sélectionnable) |
| rule-evp-payfit-absences | PAY (chemin exact, `{date, moment}`, `type`, `status`) |
| rule-evp-payfit-window | PAY (`beginDate` = premier jour de M−2, `endDate` = dernier jour de M+2, et fenêtre de `GET /sources`). Années bissextiles et passage d'année : non observable (horloge réelle), test unitaire de `payfitWindow()` |
| rule-evp-payfit-status-all | PAY (`status=all` à chaque appel ; l'annulation d'un dossier confirmé est vue comme `ANNULEE` et non comme `DISPARUE`) |
| rule-evp-payfit-status-admissible | PAY (seul `approved` confirme ; statut brut conservé ; preuve de la v1 `VALIDATED` relue en `approved` sans alerte ; `overlap_payfit` ignore `cancelled` et `declined`) |
| rule-evp-payfit-status-alerts | PAY (`cancelled` et `declined` → annulation, `pending_approval` → modification) |
| rule-evp-payfit-pending-cancellation | PAY (D-0002 ; ni alerte ni résolution d'alerte ouverte ; alerte à `cancelled`) |
| rule-evp-payfit-half-day-source | PAY (le `moment` est le seul indicateur) |
| rule-evp-payfit-half-day-mapping | PAY (D-0006 ; les quatre combinaisons interprétables ; trois combinaisons non interprétables conservées sans demi-journée, jamais confirmées, avec l'anomalie) |
| rule-evp-payfit-type-mapping | PAY (codes `fr_…`, `other` du fichier ; plusieurs codes pour un type ; codes des colonnes de la v1 conservés ; un code désignant deux types, ou en conflit avec les colonnes, ou un fichier illisible → `sources.not_configured` ; `payfitCode` des paramètres) |
| rule-evp-payfit-type-unmapped | PAY (une anomalie par code avec le décompte, absences conservées, aucune confirmation) |
| rule-evp-payfit-pagination | PAY (`maxResults=50`, trois pages de collaboratrices, contrats et absences, jeton cyclique → `sources.unexpected_format`, exhaustivité par société) |
| rule-evp-payfit-errors | PAY (401, 403, 404 ; 429 avec et sans `Retry-After`, délai doublé, trois essais puis `sources.rate_limited`) |
| rule-evp-payfit-siret-check | PAY (société non lue, anomalies « SIRET différent de la clé » et « Société inaccessible ») |
| rule-evp-payfit-companies-without-creche | PAY |
| rule-evp-payfit-proof, rule-evp-payfit-atomic-confirmation, rule-evp-payfit-alerts, rule-evp-payfit-no-manual-confirm | PAY (confirmation, alertes, disparition seulement après lecture complète de la société, restauration) ; le détail de la v1 reste couvert par `acceptance-evp-sources.test.ts` sous `fake` |

### Aqoona

| Rule id | Couverture |
|---|---|
| rule-evp-aqoona-url-secret | AQO (adresse complète nulle part ailleurs que dans la configuration), STA (`GET /sources`) |
| rule-evp-aqoona-mask | STA (`addresses[].label`/`masked`, `?…`, ordre de la configuration, libellé `Adresse 2` par défaut). Suppression des identifiants `utilisateur:mot-de-passe@` et du fragment : test unitaire de `maskUrl()` (une adresse avec identifiants ne peut pas être lue par `fetch`) |
| rule-evp-aqoona-get-only | AQO (un `GET` par adresse, aucun en-tête d'authentification, aucun paramètre ajouté, `Accept: application/json`, redirection non suivie, réponse de plus de 20 Mo refusée) |
| rule-evp-aqoona-fields | AQO (personne par matricule, sinon prénom et nom ; crèche, jour, heures) |
| rule-evp-aqoona-field-mapping | AQO (chemins pointés, tableau sous un chemin ou à la racine, deux formats de jour, fichier invalide → `sources.not_configured`) |
| rule-evp-aqoona-mapping-provisional | AQO (le fichier de correspondance est de la configuration) ; le contenu du fichier provisoire livré n'est pas testé : le format réel est inconnu |
| rule-evp-aqoona-unexpected-format | AQO (D-0004 ; moitié exactement tolérée ; plus de la moitié → `sources.unexpected_format` sans rien changer ; non JSON, JSON invalide, tableau absent) |
| rule-evp-aqoona-window | AQO (J−28 et J+35 inclus, J−29 et J+36 ignorés ; fenêtre de `GET /sources`) |
| rule-evp-sources-nir-discarded | AQO (aucune trace du NIR dans la base, les réponses, l'audit, les anomalies, le journal du serveur ; décompte « Matricule écarté ») |
| rule-evp-sources-links, rule-evp-sources-no-invention | AQO (nom de crèche normalisé, rattachement unique seulement, anomalies) |
| rule-evp-sources-aqoona, rule-evp-sources-no-auto-absence | AQO (aucune absence, aucune notification, aucun dossier modifié) |

### Règles d'écran (plans `connexion` et `sources`)

| Rule id | Couverture |
|---|---|
| rule-evp-login-google-only, rule-evp-login-service-status, rule-evp-login-safe-redirect, rule-evp-login-public-no-hr-data | GOO, UNC et v1 pour ce qui passe par l'API |
| rule-evp-login-already-connected, rule-evp-login-no-secret-in-studio | Non observable par l'API : comportement et contenu du studio (tests de navigateur, hors de ce livrable) |
| rule-evp-sources-screen, rule-evp-sources-run-polling, rule-evp-sources-guard, rule-evp-sources-windows, rule-evp-sources-payfit-aqoona-manual, rule-evp-sources-workspace-scope (libellés) | Non observable par l'API pour l'affichage (libellés « Lecture partielle », « Dernière tentative en échec… », « Adresse lue : … », polling de 2 s) ; les données qui les alimentent (`state`, `lastError`, `addresses`, fenêtres, droits) sont couvertes par STA |

## Tests unitaires attendus du développeur (non observables en boîte noire)

`maskUrl` (identifiants et fragment), `redactSecrets`, `normalisePayfitStatus`, table des demi-journées, validation du fichier de types (dont l'union avec les colonnes) et du fichier de correspondance Aqoona, `payfitWindow()` / `aqoonaWindow()` (années bissextiles, passage d'année), analyse de `PAYFIT_API_KEYS` / `AQOONA_URLS` / `SHEETS_PRIVATE_KEY` illisibles (`sources.not_configured` sans citer la valeur), `evpConfig()` sans variable Google, absence de planificateur, absence de méthode d'écriture et de `time:write` dans le code des clients, réintrospection PayFit quand la clé change.

## Effets sur la suite de la v1 (à arbitrer par la cuisine, aucun test de la v1 n'est modifié ici)

- `acceptance-evp-access.test.ts` « start redirects to Google » vérifie que le nom d'hôte de l'adresse contient `google` : il suppose `GOOGLE_AUTH_URL` non surchargée. Il doit tourner contre l'API `fake` dont l'environnement garde l'adresse officielle.
- La v1 suppose les valeurs de substitution de Google hors production : sans variables, `service-status` répond désormais `unavailable`/`google_not_configured` et `start` répond `503` (`OPEN: <titre du test>` à inscrire par les développeurs si un test de la v1 en dépend).

## Matrice des permissions

`specifications/permissions.yaml` : aucune opération ajoutée ou retirée (décision D-0005 : pas de route `POST /google-sign-in/credential`). Les entrées de `GET /service-status`, `GET /google-sign-in/start`, `GET /google-sign-in/callback`, `GET /sources`, `POST /sources/:key/refresh`, `POST /sources/refresh-all`, `GET /sources/runs/:id` et `GET /sources/:key/anomalies` gardent leur méthode, chemin, action, rôles et propriété, et gagnent les règles de la v2 qu'elles portent. `cross_owner_tests` reste vide : aucune de ces opérations ne porte de ressource d'un autre utilisateur (`ownership: none`).

## Fichiers écrits

- `acceptance/v2-helpers.ts`
- `acceptance/fixtures/payfit-absence-types.test.json`
- `acceptance/fixtures/aqoona-mapping.test.json`
- `acceptance/acceptance-v2-google-sign-in.test.ts`
- `acceptance/acceptance-v2-sources-sheets.test.ts`
- `acceptance/acceptance-v2-sources-payfit.test.ts`
- `acceptance/acceptance-v2-sources-aqoona.test.ts`
- `acceptance/acceptance-v2-sources-state.test.ts`
- `acceptance/acceptance-v2-unconfigured.test.ts`
- `acceptance/COVERAGE-v2-evp-sources.md`
- `specifications/permissions.yaml` (entrées mises à jour)
