# Couverture des règles : version v3-evp-acces-contrats-siret (EVP : liaison Google, contrats proposés, SIRET partagés, adresse Aqoona « Pros », NIR transitoire)

Version suivante de `v2-evp-sources`. Tests écrits avant tout code, d'après la demande d'origine de la version, les quatre demandes à l'API (`google-sign-in-`, `acces-`, `creches-` et `sources-api-modification-request.md`), le plan de module et les plans d'écran de `specifications/evp/implementation-plans/v3-evp-acces-contrats-siret/` et les décisions actives de `specifications/evp/arbitrages.yaml`. Les tests des versions précédentes ne sont pas modifiés.

| Sigle | Fichier | Variante d'API |
|---|---|---|
| ACC | `acceptance-v3-access.test.ts` (`googleLinked`, `PATCH` de l'adresse, `POST …/unlink-google`, coupure des sessions, comptes privilégiés) | `fake` (défaut) |
| CON | `acceptance-v3-contracts.test.ts` (contrats archivés, SIRET partagé, `planningRestricted`, `POST /absences`) | `fake` (défaut) |
| NIR | `acceptance-v3-nir-siret.test.ts` (rapprochement par NIR, jamais conservé, plusieurs SIRET, dédoublonnage) | `fake` (défaut) |
| GOO | `acceptance-v3-google-sign-in.test.ts` (les sept cas de la connexion, marches à suivre, sessions) | `pros` |
| AQO | `acceptance-v3-sources-aqoona.test.ts` (requête, fichier de correspondance, créneaux, types, noms, NIR face à un faux PayFit) | `pros` |
| PAY | `acceptance-v3-sources-payfit.test.ts` (40 clés PayFit, lecture séquentielle, collaboratrices par société) | `pros` |

Aides : `v3-helpers.ts` (lignes « Pros », serveur Aqoona factice, NIR fictifs, recherche dans toute la base) ; elle réutilise `evp-helpers.ts` et `v2-helpers.ts` sans les modifier. Fichier de configuration de recette : `fixtures/aqoona-mapping-pros.test.json` (le format « Pros » de la demande).

Le titre de chaque test commence par le ou les identifiants de règle entre crochets, puis, pour les décisions du propriétaire, `[D-xxxx]`. Pour retrouver les tests d'une règle : `jest -t "\[rule-evp-<slug>\]"`.

## Variante d'API déclarée (`acceptance/variants.yaml`)

Les fichiers ACC, CON et NIR tournent contre la variante par défaut `fake` (aucune source externe lue : PayFit est amorcé par SQL ou par `payfit.json`, Aqoona par `aqoona.json`).

Les fichiers GOO, AQO et PAY tournent contre la variante **`pros`** (nouvelle) : pilote `real`, serveurs factices démarrés par les tests sur les ports locaux 4401 (Google), 4402 (Sheets), 4403 (PayFit) et 4411 (Aqoona), propres à cette variante.
- `AQOONA_URLS` : **une seule adresse**, celle de « Pros » (`generateMicrostarsPlanningPros.php`), qui porte déjà un `dateBegin` et un `dateEnd` périmés, un paramètre étranger (`lang=fr`, à conserver) et le `securityCheck` (à conserver) : un seul scénario prouve que les deux dates sont **remplacées**, que le reste est gardé et que rien n'est ajouté.
- `AQOONA_MAPPING_FILE` : `acceptance/fixtures/aqoona-mapping-pros.test.json` (copie du format de la demande). Les tests qui altèrent temporairement le fichier de correspondance n'altèrent que cette copie ; le fichier **livré** `api/config/aqoona-mapping.json` est comparé terme à terme au format de la demande (AQO, `rule-evp-aqoona-mapping-final`).
- `PAYFIT_API_KEYS` : 40 entrées (les SIRET `11111111111111` et `22222222222222` de `seedWorld()` plus 38 SIRET `400000000000NN`) pour prouver « plus de 35 clés ».
- Aucune variable à écrire par les développeurs dans `api/.env.test` : tout vient de la variante.

## Décisions actives de la version

| Décision | Question | Choix | Épreuve (titre) |
|---|---|---|---|
| D-0010 | Q-EVP-13 | A (défaut) | Non observable (`observable: non` : configuration des fixtures, comportement identique par l'API). Le format retenu (champ `nir` de `payfit.json`, `nirUnavailable`) est celui qu'emploie NIR. |
| D-0011 | Q-EVP-11 | B (session coupée) | GOO `[rule-evp-access-unlink-session][D-0011]` (session réelle ouverte par le flux Google, puis `GET /profile` → `401 security.invalid_token`) ; ACC `[rule-evp-access-unlink-session][D-0011]` (même appel avec une session forgée) |
| D-0012 | Q-EVP-09 | A (comptes privilégiés hors de portée) | ACC `[rule-evp-access-privileged-google-fix][D-0012]` (superadmin sur un compte RH lié : `403 access.privileged_account`, liaison inchangée) |
| D-0013 | Q-EVP-10 | B, précisée par le propriétaire | CON `[rule-evp-siret-shared-contracts][D-0013]` (deuxième crèche du SIRET, planning de Camille rattaché à la première seulement : `200`, `items` vide pour `search=Camille`) ; la précision « une salariée ne peut être visible nulle part » est éprouvée par `[rule-evp-siret-shared-contracts-visible]` (salariée vue nulle part → proposée aux deux ; Aqoona jamais lue → tous) |
| D-0014 | Q-EVP-12 | A (NIR ambigu : rien rattaché, pas de repli) | NIR `[rule-evp-aqoona-nir-ambiguous][D-0014]` (pilote `fake`) et AQO `[rule-evp-aqoona-nir-ambiguous][D-0014]` (faux PayFit) : créneau stocké sans `employee_id`, anomalie `PLANNING_UNMATCHED` « Rattachement par NIR ambigu ». Le cas « même personne avec deux contrats » (un seul identifiant) est éprouvé séparément : rattaché, sans anomalie. |
| D-0008 (v2) | Q-EVP-05 | A | Reprise avec la nouvelle valeur de `erreur` : GOO `[rule-evp-google-sub-recreated][D-0008]` (`compte_recree`). Le test de la v2 (`non_autorise`) n'est pas modifié ici : litige attendu des développeurs. |

## Règles de la version : table de couverture

Légende : « Non observable » = aucune observation par l'API, HTTP ou SQL, ne peut prouver la règle ; la raison est donnée.

### Compte Google lié

| Rule id | Couverture |
|---|---|
| rule-evp-google-sub-email-mismatch | GOO (cas 2 : aucune session, `erreur=adresse_modifiee`, rien d'écrit) |
| rule-evp-google-sub-recreated | GOO (cas 5 : `erreur=compte_recree`, liaison inchangée, rien d'écrit ; `[D-0008]`) |
| rule-evp-google-sub-address-fix | GOO (adresse corrigée par `PATCH` puis connexion du même `sub` avec la nouvelle adresse ; l'ancienne adresse ne passe plus) |
| rule-evp-login-mismatch-admissible-only | GOO (cas 3 et cas 5 sur un accès non admissible : `non_autorise`, redirection identique à celle d'une adresse inconnue) |
| rule-evp-login-mismatch-no-address | GOO (ni adresse, ni `sub`, ni code, ni `state` dans la redirection ; ni `sub` ni adresse dans l'audit et le journal du serveur) |
| rule-evp-login-mismatch-no-write | GOO (instantané des comptes, utilisateurs, affectations, groupes et du nombre d'entrées d'audit, identique avant et après les refus des cas 2, 3 et 5) |
| rule-evp-login-single-denial | GOO (cas 3, 6, 7 : même refus `non_autorise`) |
| rule-evp-google-sub-binding, rule-evp-google-sign-in-audit, rule-evp-google-sub-identity, rule-evp-google-sub-mismatch (v2, inchangées) | GOO (cas 1, 4, 6, 7 ; la v2 reste la preuve détaillée) |
| rule-evp-access-address-edit | ACC (RH sur une RO, ADMINISTRATRICE sur une RO, superadmin sur une directrice ; `409 access.email_already_exists` pour l'adresse d'un autre accès, retiré compris, d'une autre casse, et d'un compte de plateforme hors EVP ; `422 access.invalid_domain` y compris domaines approchants ; adresse invalide ou de 257 caractères refusée par le schéma d'entrée ; autres champs combinés ; `404`, `400`, `401`, `403`) |
| rule-evp-access-address-keeps-link | ACC (liaison, rôle, état, nom, crèches, groupes conservés ; `base.users.email` suit ; invariant affectations/groupes ; sessions ouvertes valides), GOO |
| rule-evp-access-address-audited | ACC (une entrée « Accès », champ « adresse » nommé, ni ancienne ni nouvelle adresse ; adresse actuelle seule, même casse différente : rien d'écrit) |
| rule-evp-access-email-lock-order | ACC (deux modifications simultanées vers la même adresse : un `200`, un `409`, une seule adresse en base dans `evp_accounts` et `users`) |
| rule-evp-access-google-unlink | ACC (`200`, `googleLinked false`, `google_sub` nul, rien d'autre modifié ; accès inactif délié) |
| rule-evp-access-google-rebind | GOO (l'action ne crée aucune liaison ; la connexion suivante lie le nouveau `sub` ; l'ancien `sub` n'a aucun privilège ensuite) |
| rule-evp-access-unlink-who | ACC (RH et ADMINISTRATRICE sur une RO, superadmin sur RO et directrice ; RH et ADMINISTRATRICE sur une directrice : `403 access.role_not_manageable`) |
| rule-evp-access-unlink-needs-link | ACC (`409 access.google_not_linked`, aucune écriture, aucune entrée d'audit ; deuxième déliement et déliements simultanés) |
| rule-evp-access-unlink-audited | ACC (objet « Accès », résumé « Liaison Google levée », auteur = l'appelant, ni `sub` ni adresse) ; l'atomicité avec l'écriture (`rule-evp-audit-atomic`) n'est pas observable |
| rule-evp-access-google-linked-visible | ACC (booléen obligatoire sur chaque élément de la liste et dans les réponses de `PATCH` et du déliement ; vrai si et seulement si `google_sub` est non nul ; aucune valeur de `sub` dans les réponses) |
| rule-evp-access-privileged-google-fix | ACC (RH, ADMINISTRATRICE, SUPERADMIN non déliables ni modifiables par l'adresse, y compris par le superadmin et sur lui-même ; l'ordre des contrôles est celui de `PATCH` : `403` avant `409`) ; `[D-0012]` |
| rule-evp-access-unlink-session | ACC, GOO (session ouverte avant le déliement coupée sur toute route authentifiée ; sessions des autres accès intactes ; déliement refusé, changement d'adresse, désactivation, retrait : comportement actuel) ; `[D-0011]` |
| rule-evp-access-session-version | Non observable directement (colonne interne qui ne sort jamais de l'API) ; son effet est éprouvé par `rule-evp-access-unlink-session` (la session ouverte après le déliement est valide, la précédente reste coupée, y compris au deuxième cycle) |
| rule-evp-access-no-privileged, rule-evp-access-who-manages, rule-evp-access-no-self-role (inchangées) | ACC (appliquées à la nouvelle adresse et au déliement) ; v1 pour le reste |
| rule-evp-access-source-no-resurrect (inchangée) | Non rejouée ici : le déliement et l'adresse ne modifient ni l'état actif ni les affectations (vérifié par ACC) |

### Contrats proposés et SIRET partagé

| Rule id | Couverture |
|---|---|
| rule-evp-declare-contracts-not-archived | CON (`ARCHIVED` absent ; salariée passée d'une crèche à l'autre une seule fois, avec son contrat actif ; la recherche n'atteint jamais un contrat archivé) |
| rule-evp-declare-contracts-status | CON (`ACTIVE` et `PENDING` présents ; filtre appliqué avant la limite de 20 et avant la recherche : 25 contrats archivés qui sortent en premier ne cachent pas le contrat actif) |
| rule-evp-declare-contracts-list-only | CON (`POST /absences` sur un contrat archivé toujours accepté ; dossier existant sur contrat archivé lisible) |
| rule-evp-siret-shared-creches | CON (`GET /creches` : deux éléments distincts avec leurs codes, directrices et RO ; lecture Sheets de deux crèches de même SIRET : toutes deux vérifiées, périmètres propres, aucune anomalie de partage) |
| rule-evp-siret-one-company | CON (crèches de même SIRET partagent la société ; sans société PayFit : `items` vide et `planningRestricted` présent) |
| rule-evp-siret-shared-contracts | CON `[D-0013]` (vue à la première crèche seulement : absente de la seconde ; vue aux deux : aux deux ; planning rattaché à une autre société sans effet ; exclusion avant recherche et avant limite) |
| rule-evp-siret-shared-contracts-visible | CON (vue nulle part → proposée à chaque crèche du SIRET ; Aqoona jamais lue → tous les contrats actifs et à venir pour chacune des deux) |
| rule-evp-siret-shared-contracts-flag | CON (`planningRestricted` booléen toujours présent, vrai si et seulement si la crèche partage son SIRET avec une autre crèche **vérifiée** ; indépendant de la dernière lecture d'Aqoona) |
| rule-evp-creche-contract-match | CON (`POST /absences` : contrat de la société partagée accepté pour chaque crèche du SIRET, même pour une salariée que la liste ne propose pas là ; autre société : `409 absences.creche_contract_mismatch`) |

### Lecture « Pros »

| Rule id | Couverture |
|---|---|
| rule-evp-aqoona-read-pros | AQO (un seul `GET`, sur l'adresse « Pros » configurée ; rien d'autre n'est appelé) |
| rule-evp-aqoona-window-params | AQO (`dateBegin` = J−28, `dateEnd` = J+35, jour de Paris, `AAAA-MM-JJ`, **remplaçant** les valeurs périmées de l'adresse configurée, une fois chacun ; une requête par lecture) |
| rule-evp-aqoona-get-only | AQO (un `GET`, aucun en-tête d'authentification ni cookie, `Accept: application/json`, `securityCheck` et paramètre étranger conservés, aucun paramètre ajouté, redirection non suivie). La limite de 20 Mo, inchangée, est éprouvée par la v2. |
| rule-evp-aqoona-root-array | AQO (tableau à la racine ; un objet ou plus de la moitié de lignes inexploitables : `sources.unexpected_format` et plannings de la dernière lecture conservés) |
| rule-evp-aqoona-mapping-final | AQO (fichier livré `api/config/aqoona-mapping.json` égal au format de la demande ; `type` absent du fichier : tout `NON_PRECISE` ; `slotTypes` absent : tout type non vide en `AUTRE` ; fichier invalide : `sources.not_configured` sans citer son contenu) |
| rule-evp-aqoona-slots | AQO (Garde, PAUSE, Garde, MENAGE contigus stockés séparément, jamais fusionnés ; aucune absence, aucun dossier, aucune notification) |
| rule-evp-aqoona-window | AQO (J−29 et J+36 ignorés, bornes gardées ; fenêtre de `GET /sources`) |
| rule-evp-aqoona-dedupe | AQO, NIR (lignes identiques stockées et comptées une fois ; type ou heures différents = autre créneau ; la crèche fait partie de la clé ; lignes identiques sans crèche : un seul créneau et lecture réussie, la base ne rejette jamais ce que la mémoire a gardé) |
| rule-evp-aqoona-text-normalised | AQO (exemple de la demande, espaces parasites, casse, accents ; « Micro-Stars », « MicroStars », « Micro Stars » = même établissement) |
| rule-evp-aqoona-etab-unique | AQO (établissement ambigu entre deux crèches vérifiées, inconnu, ou seulement non vérifiée : créneau sans crèche + « Planning non rattaché ») |
| rule-evp-aqoona-person-ref | AQO (`person_ref` = « Prénom NOM » nettoyé, jamais `user_matricule`) |
| rule-evp-aqoona-slot-type-normalised | AQO (tous les alias de la demande, espaces multiples, vide, absent, inconnu, pluriel, accents) |
| rule-evp-aqoona-slot-type-anomalies | AQO (une anomalie `aqoona_slot_type_unknown` par type distinct, une `aqoona_slot_type_missing` pour tous les sans type, sans empêcher stockage ni rattachement). Le texte exact de `detail` n'est pas figé (« N créneau(x) » est un modèle) : seul le décompte est vérifié. |
| rule-evp-aqoona-partial-failure (inchangée) | AQO (adresse en échec : plannings précédents conservés) ; v2 pour l'état `PARTIAL` à plusieurs adresses |
| rule-evp-aqoona-url-secret, rule-evp-aqoona-mask (v2, inchangées) | AQO (adresse masquée dans `GET /sources`, adresse complétée avec les dates et `securityCheck` introuvables ailleurs, y compris après un échec) |

### NIR transitoire

| Rule id | Couverture |
|---|---|
| rule-evp-aqoona-nir-transient-key | NIR (pilote `fake`), AQO (faux PayFit) : rapprochement en mémoire ; volume « Rapprochés par NIR » ; « Matricule écarté » n'est plus produit |
| rule-evp-aqoona-nir-never-stored | NIR, AQO : recherche textuelle sur toutes les colonnes de toutes les tables de `base`, `GET /sources`, anomalies, exécutions, exports, audit, notifications, journal des écritures et `api/.server-test.log`, pour chaque forme du NIR fictif (normalisé, avec espaces, 13 premiers chiffres) — cas rapprochés, non rapprochés, ambigus, indisponibles, lecture en échec avec message amont qui répète le NIR, PayFit qui renvoie le NIR ; `payfit_employees` sans NIR ; aucune colonne de `aqoona_plannings` ne peut porter un NIR |
| rule-evp-aqoona-nir-over-name | NIR, AQO (NIR de la seule collaboratrice de la société, noms différents) |
| rule-evp-aqoona-nir-fallback-name | NIR, AQO (sans NIR, NIR sans correspondance, valeur d'une autre longueur) |
| rule-evp-aqoona-nir-format | NIR (espaces, points, tirets ; `2A` ; 15 caractères ; 14 chiffres ou autre longueur = absent). Le cas « PayFit ne livre que 13 chiffres » n'est pas rejoué (livraison réelle inconnue). `canonicalNir`/`looksLikeNir` : tests unitaires du développeur |
| rule-evp-aqoona-nir-scope-company | NIR (NIR porté seulement par une autre société : ignoré ; même NIR dans deux sociétés : chaque établissement rattaché à la collaboratrice de sa société, sans ambiguïté) |
| rule-evp-aqoona-nir-unavailable | NIR (`nirUnavailable`), AQO (portée absente `403`, société injoignable `500`, clé absente de `PAYFIT_API_KEYS`) : repli sur les noms, anomalie `aqoona_nir_unavailable` (sujet = SIRET, libellé et détail de la demande), lecture ni `FAILED` ni `PARTIAL` |
| rule-evp-aqoona-nir-lazy | AQO (aucune ligne à NIR : zéro appel à PayFit ; NIR d'une seule société : seule celle-ci est interrogée, en lecture seule, sans contrats ni absences, tables PayFit intactes) ; NIR (l'indisponibilité n'est signalée que pour les sociétés qui ont des lignes à NIR) |
| rule-evp-aqoona-nir-ambiguous | NIR, AQO `[D-0014]` (identifiants distincts → rien rattaché, anomalie « Rattachement par NIR ambigu », pas de repli ; une collaboratrice portant deux contrats → rattachée) |
| rule-evp-aqoona-nir-no-trace-in-types | AQO (type d'apparence NIR : `AUTRE`, sujet « Type illisible », aucune trace du NIR) |
| rule-evp-aqoona-nir-pii-logging | Partiellement observable : aucune valeur de NIR dans `api/.server-test.log` (NIR, AQO). L'absence de `console.*`/`logger.*` dans `sources/` est un test statique du développeur, non observable en boîte noire |
| rule-evp-secrets-never-exposed | AQO, GOO, NIR (voir ci-dessus) |
| rule-evp-sources-nir-discarded (v1, v2) | Remplacée pour « Pros » par `rule-evp-aqoona-nir-transient-key` : le volume « Matricule écarté » est vérifié absent (NIR, AQO). Les tests de la v1 et de la v2 qui l'attendent ne sont pas modifiés ici (litige attendu des développeurs). |

### Plusieurs SIRET, plus de 35 clés

| Rule id | Couverture |
|---|---|
| rule-evp-payfit-many-keys | PAY (40 clés : 40 sociétés, toutes leurs collaboratrices et leurs contrats ; une société en échec : lecture partielle, 39 lues, anomalie « Société inaccessible » ; lecture une société à la fois). `parsePayfitKeys` accepte 100 entrées et refuse 101 : test unitaire du développeur (la configuration de l'API de test est fixée au démarrage) |
| rule-evp-employee-multi-company | PAY (deux homonymes de deux sociétés : deux collaboratrices, jamais fusionnées), NIR (rattachement par société ; contrats proposés par chaque crèche), AQO |
| rule-evp-aqoona-multi-siret-same-day | NIR, AQO (même personne, mêmes heures, deux établissements de deux SIRET : deux séries, chacune rattachée à sa crèche, sa société et sa collaboratrice ; aucune anomalie) |

## Hypothèses retenues par la recette (à contester par un litige si elles gênent)

1. **Nom du champ NIR dans la réponse de PayFit** (point laissé ouvert par le plan de module). Les tests du pilote `fake` n'en dépendent pas (champ `nir` de `payfit.json`, décision D-0010). Les tests contre le faux PayFit (AQO : rapprochement par NIR, ambiguïté, collaboratrice à deux contrats, `[D-0014]`, NIR jamais conservé quand PayFit le renvoie) servent le NIR **sous plusieurs graphies à la fois** (`socialSecurityNumber`, `social_security_number`, `socialSecurityNumberFR`, `securityNumber`, `ssn`, `nir`) dans la liste des collaboratrices (`GET /companies/{id}/collaborators`). Si le développeur lit un autre champ ou un autre point d'accès, c'est un litige à ouvrir, pas une correction de test. Les tests de laziness (appels à PayFit) ne dépendent pas du nom du champ.
2. **Entrée invalide de `PATCH` (`email`)** : la demande dit « adresse valide, ≤ 254 » et le plan « `422` de validation » ; la convention de la v1 pour `POST /access-accounts` est `400 api.validation.incoming_failed`. Le test accepte `400` ou `422` mais exige que le code ne soit pas `access.invalid_domain`.
3. **Forme des fixtures du pilote `fake` pour Aqoona** : lignes `{ firstName, lastName, matricule, crecheName, day, start, end }` de la v1 (champs d'`AqoonaRow` inchangés). Aucun test du pilote `fake` ne dépend du champ `type` : les types sont éprouvés avec le pilote `real`.
4. **Tables internes lues par SQL** (noms de la demande et du plan de module, hors `data-contract.md`) : `aqoona_plannings(person_ref, creche_code, company_id, employee_id, day, start_time, end_time, slot_type)`, `payfit_contracts.status` (`ACTIVE`, `PENDING`, `ARCHIVED`), `payfit_companies`, `payfit_employees`, `evp_accounts.google_sub`.
5. **Ordre de la liste des contrats** : les tests de limite (21 contrats, filtre avant `limit`) placent le contrat visé en dernier par nom et par date de début ; ils ne dépendent pas d'un tri particulier au-delà de ce que ces deux critères donnent.
6. **Demi-session coupée** : la session forgée des tests (sans revendication de version de session) vaut la version 0 ; le déliement incrémente la version du compte et la coupe. La session réelle est aussi éprouvée par le flux Google (GOO).
7. **Détail des anomalies de types** : seul le décompte est exigé dans `detail` ; le sujet d'un type inconnu est comparé après normalisation (casse, accents).
8. **Libellés des volumes d'Aqoona** : « Plannings lus » (créneaux stockés dans la fenêtre, après dédoublonnage), « Plannings rattachés » (créneaux rattachés à une collaboratrice), « Rapprochés par NIR » (créneaux rattachés par le NIR).

## Effets sur les suites des versions précédentes (aucun test précédent n'est modifié ici)

- **v1** `acceptance-evp-access.test.ts` « PATCH … 400 for unknown or forbidden keys » : la liste `{ email: 'autre@micro-stars.fr' }` devient valide (`email` est désormais un champ de `PATCH`). Litige attendu des développeurs.
- **v1** `GET /creches/{code}/contracts` : la réponse gagne `planningRestricted` ; les contrats sans `status` explicite (valeur par défaut de la colonne) doivent rester proposés. Les tests qui posent des contrats `ARCHIVED` attendent l'ancien comportement.
- **v2** `acceptance-v2-google-sign-in.test.ts` : `rule-evp-google-sub-email-change` (même `sub`, autre adresse → session) est remplacée par `rule-evp-google-sub-email-mismatch` ; D-0008 passe de `non_autorise` à `compte_recree`.
- **v2** `acceptance-v2-sources-*.test.ts` : la variante `real` garde ses adresses à deux entrées et son fichier de correspondance de la v2 ; la lecture ajoute désormais `dateBegin` et `dateEnd` à l'adresse, que le faux serveur de la v2 refuse (`403`, requête différente de l'adresse configurée), et le volume « Matricule écarté » disparaît : ces tests de la v2 attendent le comportement antérieur (litiges attendus, `OPEN: <titre du test v2>` prévus par le plan de module).
- **v1** `acceptance-evp-sources.test.ts` `[rule-evp-sources-nir-discarded]` : remplacée pour « Pros » par `rule-evp-aqoona-nir-transient-key`.

## Matrice des permissions

`specifications/permissions.yaml` :
- **Ajoutée** : `POST /access-accounts/:id/unlink-google` (`access:unlink-google`, `allow: []` comme les autres routes du groupe Accès — la matrice par rôle est éprouvée par ACC —, `ownership: none`, règles de déliement, `cross_owner_tests: []`).
- **Modifiées** (règles de la version ajoutées) : `GET /access-accounts` (`googleLinked`), `PATCH /access-accounts/:id` (adresse), `GET /google-sign-in/callback` (`rule-evp-google-sub-email-change` remplacée par `rule-evp-google-sub-email-mismatch`, `rule-evp-google-sub-recreated`, `rule-evp-google-sub-address-fix`, `rule-evp-login-mismatch-*`), `GET /creches`, `GET /creches/:code/contracts` (règles de contrats et de SIRET ; un `cross_owner_tests` de plus), `GET /sources`, `POST /sources/:key/refresh`, `GET /sources/:key/anomalies`.
- Accès (méthode, chemin, action, rôles, propriété) inchangés pour toutes les autres entrées.

## Contrat de référence

Changements de contrat annoncés par les demandes, à déclarer par QA sous `allowed:` de `specifications/contract-changes.yaml` si la porte de contrat les signale : propriété de réponse obligatoire `googleLinked` (`GET /access-accounts`, `PATCH`), propriété de réponse obligatoire `planningRestricted` (`GET /creches/{code}/contracts`), propriété de corps facultative `email` (`PATCH /access-accounts/{id}`), opération `POST /access-accounts/{id}/unlink-google`. Ce fichier est en lecture seule pour QA dans cette étape ; il n'est pas modifié ici.

## Fichiers écrits

- `acceptance/v3-helpers.ts`
- `acceptance/fixtures/aqoona-mapping-pros.test.json`
- `acceptance/variants.yaml` (variante `pros` ajoutée)
- `acceptance/acceptance-v3-access.test.ts`
- `acceptance/acceptance-v3-contracts.test.ts`
- `acceptance/acceptance-v3-nir-siret.test.ts`
- `acceptance/acceptance-v3-google-sign-in.test.ts`
- `acceptance/acceptance-v3-sources-aqoona.test.ts`
- `acceptance/acceptance-v3-sources-payfit.test.ts`
- `acceptance/COVERAGE-v3-evp-acces-contrats-siret.md`
- `specifications/permissions.yaml` (entrées mises à jour)
