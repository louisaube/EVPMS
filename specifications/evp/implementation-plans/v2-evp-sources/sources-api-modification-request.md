# Demande à l'API : lectures réelles des sources (Google Sheets, PayFit, Aqoona)

Écran demandeur : Sources (et, par effet, Détail d'une absence, Notifications, Les crèches, Accès). Besoin : remplacer les connecteurs de test de la v1 par des lecteurs réels en lecture seule, entièrement paramétrables, et faire remonter à l'écran l'état exact d'une source injoignable ou refusée sans jamais exposer un secret.

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /sources` | `sources:list` (inchangé) | capacité `sources:read` (inchangé) | aucune | `200 { items: [...] }` comme en v1, avec en plus par élément : `lastError: { code: "sources.not_configured" \| "sources.unreachable" \| "sources.refused" \| "sources.rate_limited" \| "sources.unexpected_format", message: string(1..200), at: date-heure } \| null` et `addresses: [{ label: string(1..100), masked: string(1..300) }]` (rempli pour `aqoona` seulement, `[]` sinon). `state` : `workspace` vaut `UP_TO_DATE` quand la connexion Google est configurée, sinon `UNAVAILABLE` ; une source lisible dont la configuration est incomplète vaut `UNAVAILABLE` ; `ERROR` après une lecture en échec ; `PARTIAL` après une lecture partielle (decision D-0007). Sous `EVP_SOURCES_DRIVER=fake`, ni `UNAVAILABLE` (hors `workspace`) ni `PARTIAL` ne sont produits |
| `POST /sources/{key}/refresh` | `sources:refresh` (inchangé) | inchangé | `key` ∈ {`sheets`, `payfit`, `aqoona`} ; corps vide | `202 { runId, state: "RUNNING" }` ; `403` ; `404` pour `workspace` ; `409 sources.run_in_progress`. Une source non configurée est acceptée en `202` puis la lecture se termine `FAILED` avec `lastError.code = sources.not_configured` (le message dit quoi configurer, jamais une valeur) |
| `POST /sources/refresh-all` | `sources:refresh-all` (inchangé) | inchangé | corps vide | inchangé ; ordre `sheets`, `payfit`, `aqoona` ; la première lecture en échec arrête l'enchaînement |
| `GET /sources/runs/{id}` | `sources:run` (inchangé) | inchangé | `id` UUID | `200` comme en v1 ; `errorMessage` : texte français de 1..200 caractères tiré de `lastError.message`, sans adresse, clé, jeton ni valeur de configuration |
| `GET /sources/{key}/anomalies` | `sources:anomalies` (inchangé) | inchangé | inchangé | `200 { items: [{ type, label, subject, detail }], total }` ; nouveaux `type` listés dans les règles ; `subject` et `detail` sans secret, sans matricule, sans NIR ni donnée médicale |

## Configuration (variables d'environnement ; aucune valeur dans le dépôt, `api/.env.template` liste les noms)
| Variable | Rôle | Défaut |
|---|---|---|
| `EVP_SOURCES_DRIVER` | `real` pour les lecteurs réels, `fake` pour les fixtures de la v1 (hors production) | `fake` hors production, `real` en production |
| `SHEETS_BASE_URL` | base de l'API Sheets | `https://sheets.googleapis.com` |
| `SHEETS_SPREADSHEET_ID` | identifiant du classeur | aucun |
| `SHEETS_TAB_NAME` | onglet | `Contacts des crèches` |
| `SHEETS_RANGE` | plage A1 sans nom d'onglet | `A:G` |
| `SHEETS_CLIENT_EMAIL`, `SHEETS_PRIVATE_KEY` | compte d'accès (compte de service) ; secret | aucun |
| `SHEETS_TOKEN_URL` | échange du jeton d'accès du compte de service | valeur de `GOOGLE_TOKEN_URL` |
| `PAYFIT_BASE_URL` | base de l'API partenaire | `https://partner-api.payfit.com` |
| `PAYFIT_INTROSPECT_URL` | introspection de la clé | `https://oauth.payfit.com/introspect` |
| `PAYFIT_API_KEYS` | JSON `[{ "siret": "14 chiffres", "apiKey": "…" }]`, une entrée par SIRET ; secret | aucun |
| `PAYFIT_ABSENCE_TYPES_FILE` | fichier JSON `{ "<code type EVP>": ["fr_conges_payes", …] }` | `api/config/payfit-absence-types.json` |
| `PAYFIT_RETRY_DELAY_MS` | attente de base avant nouvel essai sur 429 | `1000` |
| `AQOONA_URLS` | JSON `[{ "label": "…", "url": "https://…?…" }]` ; l'adresse complète est un secret | aucun |
| `AQOONA_MAPPING_FILE` | fichier JSON de correspondance des champs (voir `rule-evp-aqoona-field-mapping`) | `api/config/aqoona-mapping.json` |

## Règles

### Communes
- `rule-evp-sources-readonly` (user, inchangé) : toutes les lectures sont en lecture seule ; aucune méthode d'écriture n'est appelée sur Sheets, PayFit ni Aqoona. Les seuls appels autres que `GET` sont ceux qui obtiennent un accès (jeton du compte de service, introspection PayFit) et ils ne modifient rien chez la source.
- `rule-evp-sources-configurable` (user, decision D-0003) : adresses de base, identifiants et secrets viennent de la configuration d'environnement, de sorte que la recette les pointe vers des serveurs factices. Un seul interrupteur global `EVP_SOURCES_DRIVER` (`real` ou `fake`) vaut pour tout le processus : en `real`, les trois sources sont réelles et une source non configurée (par exemple `PAYFIT_API_KEYS` absent) se termine `FAILED` avec `lastError.code = sources.not_configured` ; aucun repli sur les fixtures de la v1 par source. La recette lance l'API de test deux fois, une par pilote.
- `rule-evp-secrets-never-exposed` (user) : aucun secret (clé PayFit, adresse Aqoona complète, clé privée, secret client, jeton d'accès) n'est écrit dans le dépôt, les journaux applicatifs, les entrées du journal d'audit, les exports, `errorMessage`, `lastError`, les anomalies, ni un message d'erreur. Les messages désignent la source et la cause, jamais la valeur.
- `rule-evp-sources-failure-state` (user) : une source injoignable ou refusée affiche son état, sans donnée inventée : la lecture se termine `FAILED` (échec global ; voir `rule-evp-sources-partial-failure` pour l'échec d'une société ou d'une adresse parmi d'autres), rien n'est copié, les données et `lastReadAt` du dernier succès sont conservés (`lastReadAt` reste la date du dernier succès).
- `rule-evp-sources-error-codes` (inferred) : causes d'échec classées : `sources.not_configured` (variable absente), `sources.unreachable` (réseau, délai de 30 s dépassé, 5xx persistant, 404 de base), `sources.refused` (401, 403), `sources.rate_limited` (429 persistant après les essais), `sources.unexpected_format` (réponse non JSON, champ attendu absent, plage vide inattendue).
- `rule-evp-sources-run-single` (inferred, inchangé) : une seule lecture à la fois par source (`409`).
- `rule-evp-sources-refresh-audited` (inferred, inchangé) : chaque lecture lancée est journalisée ; le résumé ne contient ni adresse ni clé.
- `rule-evp-sources-partial-failure` (inferred, decision D-0007) : lecture partielle. Une société PayFit (une clé) ou une adresse Aqoona en échec n'empêche pas de copier celles qui répondent. La lecture se termine `SUCCEEDED` et la source passe à l'état `PARTIAL` (« Lecture partielle ») tant qu'au moins une société ou adresse est en échec ; `lastReadAt` est la date de cette lecture, `lastError` reste `null`. Chaque société ou adresse en échec garde ses données précédentes, sans alerte de disparition (sa couverture est non exhaustive, `reachable = false`), et crée une anomalie : « Société inaccessible » (type `payfit_company_unreachable`, `subject` = SIRET ou libellé de société, `detail` = « Clé refusée pour une société », « Portée PayFit manquante », « Société introuvable » ou autre cause classée, sans secret) ; pour Aqoona, « Adresse Aqoona inaccessible » (type `aqoona_address_unreachable`, `subject` = libellé de l'adresse). Les sociétés ou adresses qui répondent sont copiées, leur couverture est exhaustive. Si toutes les sociétés (ou toutes les adresses) échouent, ou si l'échec est global (`sources.not_configured`, configuration illisible, fichier de types invalide), la lecture entière est `FAILED` selon `rule-evp-sources-failure-state` (backend, inferred).
- `rule-evp-sources-timeouts` (inferred) : délai de 30 s par appel, 3 tentatives au plus par appel sur 429 ou 5xx, aucune sur 4xx autre.
- `rule-evp-sources-no-scheduler` (user) : aucune lecture planifiée côté EVP ; seule une action humaine lance une lecture.

### Google Sheets (API v4)
- `rule-evp-sheets-values-get` (user) : un appel `GET {SHEETS_BASE_URL}/v4/spreadsheets/{SHEETS_SPREADSHEET_ID}/values/{plage}` (`spreadsheets.values.get`), où `plage` est la notation A1 préfixée du nom d'onglet, entre apostrophes et encodée (`'Contacts des crèches'!A:G`).
- `rule-evp-sheets-scope-readonly` (user) : la portée OAuth demandée est `https://www.googleapis.com/auth/spreadsheets.readonly`, et elle seule.
- `rule-evp-sheets-configurable` (user) : identifiant du classeur, onglet, plage et identifiants du compte d'accès sont paramétrables.
- `rule-evp-sheets-service-account` (inferred, decision D-0009) : le jeton d'accès s'obtient par le flux JWT-bearer du compte de service (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`) sur `SHEETS_TOKEN_URL`, mis en cache jusqu'à `expires_in` moins 60 s.
- `rule-evp-sheets-columns` (user) : l'onglet fournit nom de la crèche, code, SIRET, adresse de connexion, nom de la directrice, nom et e-mail de la RO.
- `rule-evp-sheets-header-driven` (inferred) : la première ligne de la plage est l'en-tête ; les colonnes sont retrouvées par leur intitulé (casse et accents ignorés : « Nom », « Code », « SIRET », « Adresse de connexion », « Directrice », « RO nom », « RO e-mail »), pas par leur position ; un intitulé manquant donne `sources.unexpected_format`.
- `rule-evp-sheets-formatted-values` (inferred) : la lecture demande `valueRenderOption=FORMATTED_VALUE` et `majorDimension=ROWS` pour que les SIRET ne soient pas convertis en nombres ; une réponse sans `values` est une plage vide (aucune crèche), pas une erreur.
- `rule-evp-sources-sheets` (user, inchangé) : référentiel des crèches, confirmation des affectations de directrices, écarts RO signalés.
- `rule-evp-sources-ro-gaps-not-overwritten` (user, inchangé) : aucun compte n'est créé, réactivé ni modifié par la lecture ; écart RO = anomalie.
- `rule-evp-sources-sheets-superadmin` (user, inchangé) : lancée par le superadmin seul, avant PayFit et Aqoona dans « Toutes les sources ».
- Erreurs : 400 (« Unable to parse range », onglet absent) → `sources.unexpected_format` ; 401 et 403 (classeur non partagé avec le compte) → `sources.refused` ; 404 → `sources.unreachable` ; 429 → attente puis essai.

### PayFit (API partenaire)
- `rule-evp-payfit-bearer` (user) : chaque appel porte `Authorization: Bearer <clé de la société>` ; une clé par société, limitée à ses données ; table de clés paramétrable, une entrée par SIRET.
- `rule-evp-payfit-company-id` (user) : l'identifiant de société s'obtient par `POST {PAYFIT_INTROSPECT_URL}` avec la clé en Bearer et le corps `{"token": "<clé>"}` ; la réponse contient `company_id`, conservé (`payfit_companies`) et réutilisé aux lectures suivantes sans nouvel appel tant que la clé est inchangée.
- `rule-evp-payfit-scopes` (user) : portées demandées `collaborators:read`, `contracts:read`, `time:read`, jamais `time:write` ; aucune écriture dans PayFit.
- `rule-evp-payfit-company` (user) : `GET /companies-fr/{companyId}` ; le SIRET est lu dans `identificationNumber` (le champ déprécié `siret` n'est pas utilisé).
- `rule-evp-payfit-siret-check` (inferred) : si `identificationNumber` diffère du SIRET de l'entrée de configuration, la société n'est pas lue et une anomalie « SIRET différent de la clé » est créée (traité comme un échec de société selon `rule-evp-sources-partial-failure` : la société garde ses données précédentes et est aussi signalée « Société inaccessible »).
- `rule-evp-payfit-collaborators` (user) : `GET /companies/{companyId}/collaborators` ; `id`, `firstName`, `lastName` ; la société est celle du chemin (le collaborateur n'a pas de champ société).
- `rule-evp-payfit-contracts` (user) : `GET /companies/{companyId}/contracts-fr` ; `contractId`, `collaboratorId`, `startDate`, `endDate`, `status` (`ACTIVE`, `ARCHIVED`, `PENDING`) ; les champs personnels du contrat (dépréciés) ne sont pas lus : le nom vient de la collaboratrice.
- `rule-evp-payfit-contracts-all-statuses` (inferred) : tous les statuts de contrat sont lus et conservés, un contrat archivé pouvant porter une absence de la fenêtre.
- `rule-evp-payfit-absences` (user) : `GET /companies/{companyId}/absences` avec `beginDate` et `endDate` ; une absence est retenue si elle chevauche la période ; champs `id`, `contractId`, `startDate` et `endDate` sous la forme `{date, moment}`, `type`, `status`.
- `rule-evp-payfit-window` (user) : fenêtre de lecture du début de M−2 à la fin de M+2 (`beginDate` = premier jour de M−2, `endDate` = dernier jour de M+2).
- `rule-evp-payfit-status-all` (user) : la lecture demande `status=all` pour détecter modification, annulation et disparition ; statuts possibles `approved`, `pending_approval`, `declined`, `cancelled`, `pending_cancellation`.
- `rule-evp-payfit-status-admissible` (inferred) : seul `approved` est un statut source admissible pour confirmer un dossier (`rule-evp-payfit-proof`) ; les autres statuts sont conservés mais ne confirment rien.
- `rule-evp-payfit-status-alerts` (inferred) : sur un dossier confirmé, `cancelled` ou `declined` → alerte d'annulation ; `pending_approval` → alerte de modification ; `pending_cancellation` : voir `rule-evp-payfit-pending-cancellation`.
- `rule-evp-payfit-pending-cancellation` (inferred, decision D-0002) : `pending_cancellation` ne déclenche aucune alerte ; l'alerte d'annulation naît quand le statut devient `cancelled`.
- `rule-evp-payfit-half-day-source` (user) : `moment` (`beginning-of-day`, `middle-of-day`, `end-of-day`) est le seul indicateur de demi-journée.
- `rule-evp-payfit-half-day-mapping` (inferred, decision D-0006) : début : `beginning-of-day` → `MATIN`, `middle-of-day` → `APRES_MIDI` ; fin : `middle-of-day` → `MATIN`, `end-of-day` → `APRES_MIDI` ; toute autre combinaison est non interprétable : l'absence PayFit est conservée avec un `start_half`/`end_half` nul, ne confirme aucun dossier, et crée l'anomalie « Demi-journée PayFit non interprétable ».
- `rule-evp-payfit-type-mapping` (user) : les types PayFit (codes `fr_…`, `colleague_…`, `other`) sont rapprochés des neuf types EVP par une configuration (`PAYFIT_ABSENCE_TYPES_FILE`), pas par du code figé ; plusieurs codes PayFit peuvent désigner un type EVP, un code PayFit ne désigne jamais deux types.
- `rule-evp-payfit-type-unmapped` (inferred) : un code PayFit absent de la configuration est conservé tel quel, ne confirme aucun dossier et crée l'anomalie « Type d'absence PayFit non configuré » (un seul par code, avec le nombre d'absences).
- `rule-evp-payfit-pagination` (user) : `maxResults=50`, puis `nextPageToken` pris dans `meta.nextPageToken` jusqu'à `null` ; la lecture n'est exhaustive pour une société que si toutes les pages ont été lues sans erreur.
- `rule-evp-payfit-errors` (user) : 401 → `sources.refused` (« Clé PayFit refusée ») ; 403 → `sources.refused` (« Portée PayFit manquante », sans nommer la clé) ; 404 → `sources.unreachable` (société introuvable) ; 429 → attente (`Retry-After` si présent, sinon `PAYFIT_RETRY_DELAY_MS` doublé à chaque essai) puis nouvel essai, jusqu'à 3 essais puis `sources.rate_limited`.
- `rule-evp-payfit-companies-without-creche` (user, inchangé) : société sans crèche (SIRET) → anomalie « Société sans crèche (SIRET) ».
- `rule-evp-payfit-proof`, `rule-evp-payfit-atomic-confirmation`, `rule-evp-payfit-alerts`, `rule-evp-payfit-no-manual-confirm` (user, inchangés) : le rapprochement de la v1 s'applique aux données lues, avec l'admissibilité, les demi-journées et les types ci-dessus.
- `rule-evp-sources-manual` (user, inchangé) : déclenchement manuel par RH et superadmin.

### Aqoona (adresse tokenisée, JSON)
- `rule-evp-aqoona-url-secret` (user) : l'adresse complète est un secret paramétrable (`AQOONA_URLS`), plusieurs adresses possibles si une par société ; jamais écrite en clair dans les journaux, les erreurs, les exports ni l'écran Sources.
- `rule-evp-aqoona-mask` (user) : là où une adresse est montrée (`addresses[].masked`), la partie à partir du `?` est remplacée par `?…` ; les identifiants de type `utilisateur:mot-de-passe@` et le fragment `#` sont supprimés (inferred).
- `rule-evp-aqoona-get-only` (inferred) : un seul `GET` par adresse, sans en-tête d'authentification, sans ajout de paramètre à l'adresse (le mot de passe y est), redirections non suivies, `Accept: application/json`, réponse limitée à 20 Mo.
- `rule-evp-aqoona-fields` (user) : champs attendus : référence de la personne (matricule utilisable, sinon prénom et nom), nom de crèche, jour, heure de début, heure de fin.
- `rule-evp-aqoona-field-mapping` (user) : la correspondance des champs est un fichier de configuration (`AQOONA_MAPPING_FILE`) : `{ "records": "<chemin pointé vers le tableau, vide pour la racine>", "fields": { "matricule": "<chemin>", "prenom": "<chemin>", "nom": "<chemin>", "creche": "<chemin>", "jour": "<chemin>", "debut": "<chemin>", "fin": "<chemin>" }, "dayFormat": "YYYY-MM-DD" \| "DD/MM/YYYY", "timeFormat": "HH:mm" \| "HH:mm:ss" }`. Les chemins sont des noms de propriété séparés par des points.
- `rule-evp-aqoona-mapping-provisional` (inferred) : le format réel n'est pas connu ; le fichier livré est provisoire (champs `matricule`, `prenom`, `nom`, `creche`, `jour`, `debut`, `fin` à la racine d'un tableau) jusqu'à la fourniture d'un exemple de réponse réelle anonymisé par l'humain.
- `rule-evp-aqoona-unexpected-format` (inferred, decision D-0004) : réponse non JSON, `records` qui n'est pas un tableau, ou enregistrement sans crèche, jour ou heure exploitable → `sources.unexpected_format` pour la réponse entière si plus de la moitié des enregistrements sont inexploitables, sinon la ligne est écartée et comptée dans une anomalie « Ligne Aqoona inexploitable ».
- `rule-evp-aqoona-window` (user) : fenêtre de lecture de J−28 à J+35 ; l'adresse ne se filtre pas, la fenêtre est donc appliquée à la lecture (inferred) : les créneaux hors fenêtre sont ignorés.
- `rule-evp-sources-nir-discarded` (user, inchangé) : un matricule qui ressemble à un NIR est écarté, jamais stocké, journalisé ni affiché ; seul le décompte est visible.
- `rule-evp-sources-links` (user, inchangé) : nom de crèche normalisé puis prénom et nom dans cette crèche ; rattaché si la correspondance est unique, sinon ligne non rattachée et anomalie visible.
- `rule-evp-sources-aqoona` (user, inchangé) et `rule-evp-sources-no-auto-absence` (user, inchangé) : aucune absence n'est créée depuis Aqoona.
- Erreurs : 401, 403 → `sources.refused` (« Adresse Aqoona refusée ») ; 404, réseau, délai → `sources.unreachable` ; 429 et 5xx → nouvel essai puis `sources.unreachable`.

## Compatibilité
- `GET /sources` gagne `lastError` et `addresses` (champs obligatoires, valeurs nulles ou vides le cas échéant) et un état `PARTIAL` (decision D-0007) : changement de la réponse du contrat de référence → `OPEN: contract GET /sources: ajout de lastError et addresses à la réponse (état PARTIAL)` à inscrire dans `DISPUTES.md` du dossier du plan. `GET /sources/runs/{id}` ne change pas de forme.
- Pas d'autre opération ajoutée ou modifiée ; la matrice `permissions.yaml` ne bouge pas.
- Statuts d'absence : la colonne garde la valeur brute de PayFit ; les valeurs de la v1 (`VALIDATED`, `CANCELED`, `PENDING`), semées par la suite de recette de la v1 sous `EVP_SOURCES_DRIVER=fake`, restent valides et sont rapprochées de `approved`, `cancelled`, `pending_approval` à la lecture (aucune migration de données).
- Nouvelles tables ou colonnes de la fonctionnalité `sources` (dans son propre fichier `*.tables.ts`) : identifiant de société PayFit conservé, statut de contrat, `source_runs.error_code` et `source_runs.partial`, `start_half` et `end_half` nullables dans `payfit_absences` (demi-journée non interprétable), couverture par société (`reachable`), libellé de l'adresse d'origine dans les plannings Aqoona (`address_label`, pour conserver les plannings d'une adresse en échec). Si QA y voit une extension du schéma `base`, dispute à ouvrir.
- Le connecteur `FixtureSourceConnectors` de la v1 reste disponible avec `EVP_SOURCES_DRIVER=fake` (les tests de la v1 continuent, dans une API de test lancée avec ce pilote) ; la recette de la v2 lance l'API de test avec `real` et des serveurs factices HTTP (decision D-0003).
- `api/.env.template` liste les nouvelles variables en commentaires, sans valeur secrète.
- La correspondance PayFit ↔ type EVP vient du fichier de configuration. Les colonnes `absence_types.payfit_code` / `payfit_compatible_codes` de la v1 restent lues : les codes d'un type sont l'union du fichier et de ces colonnes (un code ne désigne jamais deux types). `GET /settings` garde sa forme ; `payfitCode` vaut la colonne si elle est renseignée, sinon, sous le pilote `real`, le premier code du fichier ; aucune rupture.
