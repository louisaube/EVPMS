# Couverture des règles : version v5-evp-rattachement-nir (EVP : rattachement par le NIR seul, sur tout le réseau)

Version suivante de `v4-evp-fiabilite-nir`. Tests écrits avant tout code, d'après la demande d'origine de la version, la demande à l'API (`sources-api-modification-request.md`), le plan de module et le plan d'écran de `specifications/evp/implementation-plans/v5-evp-rattachement-nir/`, `questions.yaml` de ce dossier et les décisions actives de `specifications/evp/arbitrages.yaml` (D-0020 à D-0024).

**Aucun test n'a pu être exécuté** : la session de QA n'a pas de shell. Les fichiers sont écrits et relus à la main ; la première exécution contre l'API des développeurs peut révéler des fautes de frappe ou des hypothèses de texte à corriger (voir « Hypothèses »).

| Sigle | Fichier | Variante d'API |
|---|---|---|
| LIE | `acceptance-v5-linking.test.ts` (rattachement par le NIR seul, tout le réseau, les cinq causes, ligne sans identité, établissement inconnu, décisions D-0020 à D-0024, clé de contrôle des deux côtés, société nommée, dédoublonnage, colonnes stockées, aucun NIR visible) | `fake` (défaut) |
| TPE | `acceptance-v5-people-rates.test.ts` (`GET /sources/aqoona/matching-rates` en personnes par société et `GET /sources/aqoona/unlinked-people` : droits, états, calcul, tri, pagination, confidentialité, contrat OpenAPI) | `fake` (défaut) |
| POF | `acceptance-v5-payfit-scope.test.ts` (lecture PayFit : portée manquante et introspection en échec signalées à chaque lecture, société nommée, aucune lecture de NIR) | `fake` (défaut) |
| RES | `acceptance-v5-sources-introspection.test.ts` (pilote réel : une introspection par clé et par lecture, formats de portée, causes d'échec, réseau entier lu, D-0018, D-0024, confidentialité) | `network` (nouvelle) |
| CRE | `acceptance-v5-creches-shared-siret.test.ts` (contrats offerts par les crèches à SIRET partagé quand le créneau est lu pour une volante) | `fake` (défaut) |

Aides : `v5-helpers.ts` (textes de l'API, fabrique des fixtures `payfit.json` à NIR, ordinateur de lecture, taux et liste, créneaux posés en SQL). Il réutilise `evp-helpers.ts`, `v2-helpers.ts`, `v3-helpers.ts` et `v4-helpers.ts` sans les modifier.

Le titre de chaque test commence par le ou les identifiants de règle entre crochets, puis, pour les décisions, `[D-xxxx]`. Pour retrouver les tests d'une règle : `jest -t "\[rule-evp-<slug>\]"`.

## Variante d'API déclarée (`acceptance/variants.yaml`)

LIE, TPE, POF et CRE tournent contre la variante par défaut `fake`. RES tourne contre la variante **`network`** (nouvelle), qui ne modifie aucune variante existante :
- pilote `real` ; serveurs factices démarrés par les tests sur les ports locaux 4601 (Google), 4602 (Sheets), 4603 (PayFit, introspection comprise) et 4611 (Aqoona « Pros »), propres à la variante ;
- `PAYFIT_API_KEYS` : deux clés propres à la variante (SIRET `11111111111111` et `22222222222222`, comme `seedWorld()`) ; `PAYFIT_INTROSPECT_URL` : `http://127.0.0.1:4603/introspect` ;
- `AQOONA_URLS` : l'adresse « Pros » unique avec son `securityCheck` propre ; `AQOONA_MAPPING_FILE` : `acceptance/fixtures/aqoona-mapping-pros.test.json` (inchangé) ;
- aucune variable à écrire par les développeurs dans `api/.env.test`.

## Décisions actives de la version

Chaque épreuve appelle la route et attend le résultat du `test` de l'option retenue dans `questions.yaml`.

| Décision | Question | Choix | Épreuve (titre) |
|---|---|---|---|
| D-0020 | Q-EVP-19 | A (NIR porté par deux sociétés : `NIR_AMBIGUOUS`) | LIE `[rule-evp-link-nir-two-companies][D-0020] GET /sources/aqoona/unlinked-people with the same NIR (right key) carried by a collaborator of Alpha and one of Beta…` |
| D-0021 | Q-EVP-20 | B (`PAYFIT_INCOMPLETE` quand une société est illisible) | LIE `[rule-evp-link-incomplete-read][D-0021] GET /sources/aqoona/unlinked-people with Alpha in nirScopeMissing…` |
| D-0022 | Q-EVP-21 | A (établissement inconnu : rattachée, sans anomalie d'établissement) | LIE `[rule-evp-link-unknown-creche][D-0022] GET /sources/aqoona/anomalies with a row whose NIR… and whose establishment is absent from the referential…` |
| D-0023 | Q-EVP-22 | A (personne comptée rattachée et non reliée) | LIE `[rule-evp-link-person-both-states][D-0023] GET /sources/aqoona/unlinked-people with two rows « Camille DURAND »…` |
| D-0024 | Q-EVP-23 | A (NIR trouvé en direct pour une collaboratrice non lue : `PAYFIT_INCOMPLETE`) | LIE `[rule-evp-link-employee-not-read][D-0024] GET /sources/aqoona/unlinked-people with a collaborator of Alpha present in the live NIR…` ; RES `[rule-evp-link-employee-not-read][D-0024] a collaborator found in PayFit live but never recorded…` (même cas avec le pilote réel) |

Décisions des versions précédentes dont l'épreuve a été réécrite (comportement changé par la v5) : D-0014 (ambigu : le détail est maintenant le libellé de la cause) ; D-0019 (couverture : remplacée, le réseau entier est lu dès qu'une ligne a un NIR de clé juste ; le titre ne porte plus l'étiquette `[D-0019]`) ; D-0016 et D-0015 (voir TPE : le mode inconnu est étendu à `NOM`/`INCONNU`/valeur par défaut, la ligne « Sans société identifiée » est comptée en personnes).

## Règles de la version : table de couverture

Légende : « Non observable » = aucune observation par l'API, HTTP ou SQL, ne peut prouver la règle ; la raison est donnée.

### Rattachement par le NIR seul

| Rule id | Couverture |
|---|---|
| rule-evp-link-nir-only | LIE (même nom, NIR absent : non rattachée ; NIR sur un autre nom : rattachée ; nom d'une collaboratrice avec un NIR inconnu : non rattachée) ; réécritures : v3-nir-siret, v3-sources-aqoona, v4-nir-key, v4-sources-payfit-scope, evp-sources, v2-sources-aqoona (plus aucune collaboratrice trouvée par son nom) ; v3-contracts, CRE (une ligne au nom d'une collaboratrice sans NIR ne l'exclut de rien) |
| rule-evp-link-network-wide | LIE (NIR porté par une collaboratrice d'une autre société que celle de la crèche : rattachée à elle, `employee_company_id` ≠ `company_id`) ; v3-nir-siret, v3-sources-aqoona (même personne dans deux établissements de deux SIRET : une seule collaboratrice) ; CRE |
| rule-evp-link-one-establishment | LIE (volante : `company_id` de la crèche lue, `employee_company_id` de sa société de référence ; une salariée n'a qu'une société) ; CRE (identifiant de collaboratrice d'une autre société identique à celui d'une salariée : jamais confondus) |
| rule-evp-link-nir-two-companies | LIE `[D-0020]` ; v3-nir-siret (même NIR chez deux sociétés : les deux lignes `NIR_AMBIGUOUS`) ; RES (ambiguïté entre deux sociétés avec le pilote réel) |
| rule-evp-link-unusable-nir | LIE (NIR absent, de forme illisible, de clé fausse, inconnu : anomalie « Planning non rattaché » avec le libellé de la cause et la crèche lue, jamais de NIR) ; v3-nir-siret, v4-nir-key |
| rule-evp-link-causes | LIE (chacune des cinq causes ; ordre : NIR absent avant clé fausse ; seul l'ordre non ambigu est affirmé) ; TPE (toutes les causes visibles dans la liste) ; v4-nir-key (mode stocké `NIR` ou `AUCUN`) |
| rule-evp-link-incomplete-read | LIE `[D-0021]` (portée manquante) ; v3-nir-siret, v3-sources-aqoona, v4-nir-key, v4-sources-payfit-scope (société illisible, sans portée ou sans clé : lignes non rattachées, anomalie « Rapprochement par NIR indisponible » qui nomme la société) ; RES (toutes les causes d'échec de l'introspection) ; LIE (réseau illisible : `payfit.json` invalide) |
| rule-evp-link-no-identity | LIE (ni nom ni NIR : anomalie `aqoona_no_identity` « Ligne Aqoona sans nom ni NIR » avec le décompte, créneau conservé non rattaché, hors liste et hors taux, lecture `SUCCEEDED`) ; TPE (hors liste et hors taux) |
| rule-evp-link-unknown-creche | LIE `[D-0022]` (rattachée, crèche nulle, aucune anomalie d'établissement ; société inconnue de `payfit_companies`) ; v3-sources-aqoona (établissement inconnu, ambigu ou non vérifié sans NIR : conservé sans crèche, « Planning non rattaché ») |
| rule-evp-link-network-read | RES (dès qu'une ligne a un NIR de clé juste : les deux clés introspectées, les deux listes de collaboratrices demandées ; aucun appel à PayFit sinon) ; v3-sources-aqoona (réseau entier demandé pour une ligne d'une seule société) ; v3-nir-siret (aucune lecture sans NIR utilisable ; toutes les sociétés illisibles signalées) ; v4-sources-payfit-scope |
| rule-evp-link-person-both-states | LIE `[D-0023]` ; TPE (une personne dans les deux parts d'une même société) |
| rule-evp-link-employee-not-read | LIE `[D-0024]` ; RES `[D-0024]` (avant puis après la lecture complète de PayFit) |
| rule-evp-nir-key-invalid-unused | v4-nir-key, v4-sources-payfit-scope (clé fausse des deux côtés : non rattachée, cause `NIR_KEY_INVALID`, volume « Rapprochés par NIR » à 0 ; collaboratrice PayFit à clé fausse introuvable, sans rendre ambigu un NIR juste d'une autre) ; LIE (clé de contrôle des deux côtés) |
| rule-evp-matching-method-first-row | v4-nir-key (deux créneaux identiques gardent le mode de la première ligne retenue) |
| rule-evp-aqoona-nir-never-stored | v3-nir-siret, v3-sources-aqoona, v4-nir-key, LIE (colonnes stockées : `employee_company_id`, `match_method`, `unlinked_cause`, `creche_label` ; aucune colonne ni valeur qui ressemble à un NIR, un condensat ou un fragment) |

### Taux en personnes et liste des personnes non reliées

| Rule id | Couverture |
|---|---|
| rule-evp-matching-rates-people | TPE (une personne = un nom normalisé, comptée une fois par société, même sur plusieurs créneaux, crèches ou jours) ; LIE ; v4-sources-payfit-scope (taux face à une lecture réelle) |
| rule-evp-matching-rates-company-of-person | TPE (la société d'une personne est celle de sa crèche lue ; une volante est comptée dans la société de la crèche qu'elle a lue) |
| rule-evp-matching-rates-consistency | TPE (taux = liste = volumes de `GET /sources` après une lecture réelle) ; v4-matching-rates, v4-sources-payfit-scope |
| rule-evp-matching-rates-unknown-mode | TPE (créneau `NOM`, `INCONNU` ou valeur par défaut : `available false` et `items` vide, dernière lecture et fenêtre conservées ; la lecture complète suivante rétablit les taux) |
| rule-evp-matching-rates-percent | TPE (`round(100 × n / total, 1)` en personnes) |
| rule-evp-matching-rates-no-company | TPE (ligne « Sans société identifiée » en dernier) |
| rule-evp-matching-rates-route, -same-rights, -live, -no-nir | TPE (RH et SUPERADMIN 200 ; directrice, RO, ADMINISTRATRICE 403 ; anonyme et jeton invalide 401 ; GET seulement ; aucune écriture, aucun audit ; aucune forme de NIR, de nom ni de secret) ; v4-matching-rates (droits, états, lecture seule, contrat des erreurs : conservés ; le test instable est corrigé) |
| rule-evp-unlinked-list | TPE (200, une ligne par personne : nom, cause, crèches ; liste vide si tout est relié) |
| rule-evp-unlinked-list-same-rights | TPE (mêmes droits que l'écran des sources) |
| rule-evp-unlinked-list-no-nir | TPE, LIE (jamais un NIR, ni normalisé, ni en 13 chiffres, ni dans le journal du serveur) |
| rule-evp-unlinked-list-grain | TPE (une ligne par personne et par société ; « Personne non nommée » pour une ligne à NIR sans nom) |
| rule-evp-unlinked-list-paging | TPE (tri en ordre français, pagination sur 60 personnes, bornes 400 `api.validation.incoming_failed`, crèches tronquées à 50) |
| rule-evp-unlinked-list-all-causes-visible | TPE (les cinq causes dans la liste). L'affichage lui-même (écran, libellés exacts) : non observable par l'API, couvert par les tests Playwright de `acceptance/e2e/` |

### Portée PayFit à chaque lecture, société nommée

| Rule id | Couverture |
|---|---|
| rule-evp-payfit-scope-every-read | POF (pilote `fake` : liste `nirScopeMissing`) ; RES (pilote réel : une introspection POST par clé à chaque lecture de PayFit, même avec un identifiant en cache) ; v2-sources-payfit (le test « sans nouvelle introspection » est réécrit : 6 appels pour 3 lectures) |
| rule-evp-payfit-scope-introspection-failed | POF (liste `introspectionFailed`) ; RES (`active` faux, 401, 403, 429, 500, 503, réponse inattendue : une anomalie PayFit avec la cause en mots) |
| rule-evp-payfit-scope-no-nir-read | POF, RES `[D-0018]` (aucune lecture de NIR pendant la lecture PayFit ; aucun `GET …/collaborators` pour le NIR) ; v4-nir-key, v4-sources-payfit-scope |
| rule-evp-payfit-scope-no-failure | POF, RES (lecture `SUCCEEDED` et `UP_TO_DATE`, jamais `PARTIAL` ni `FAILED` à cause d'une portée manquante ou d'une introspection en échec) |
| rule-evp-payfit-scope-read-only | RES (le `POST` d'introspection est le seul `POST`) ; v4-sources-payfit-scope. « Aucune portée n'est demandée par le code » : non observable |
| rule-evp-payfit-scope-format | RES (chaîne ou tableau de portées, comparaison exacte) ; v4-sources-payfit-scope (conservé, textes réécrits) |
| rule-evp-payfit-scope-one-per-key | RES ; v4-sources-payfit-scope (une seule introspection par clé et par lecture, avec la clé en `Bearer`) |
| rule-evp-payfit-scope-coverage | Remplacée (D-0019) : v4-nir-key, v4-sources-payfit-scope réécrits (dès qu'une ligne a un NIR de clé juste, toutes les sociétés sont lues et signalées) |
| rule-evp-company-named-in-anomalies | POF (« Nom (SIRET xxx) » pour la portée manquante et l'introspection en échec ; « Société sans nom connu (SIRET xxx) » ; le nom suit un renommage) ; v3-nir-siret, v3-sources-aqoona, v4-nir-key, v4-sources-payfit-scope (« Rapprochement par NIR indisponible » nomme la société) |

### Règles inchangées ou remplacées, éprouvées par les anciens tests réécrits

| Rule id | Couverture |
|---|---|
| rule-evp-aqoona-nir-fallback-name, -over-name, -scope-company, -lazy, rule-evp-employee-multi-company (pour le NIR) | Remplacées par la v5 : les tests qui les portaient sont réécrits dans v3-nir-siret, v3-sources-aqoona et v4-nir-key (le titre garde l'étiquette de la règle quand il reste pertinent) |
| rule-evp-aqoona-nir-ambiguous | v3-nir-siret `[D-0014]`, v3-sources-aqoona `[D-0014]` (même société : maintenant le libellé de la cause) |
| rule-evp-aqoona-nir-unavailable | v3-nir-siret, v3-sources-aqoona, v4-nir-key (étendue : société nommée, lignes non rattachées) |
| rule-evp-aqoona-nir-format, rule-evp-nir-key-formula, -vectors, -both-sides, -never-shown | v3-nir-siret, v4-nir-key, v4-sources-payfit-scope (inchangés) |
| rule-evp-siret-shared-contracts | CRE ; v3-contracts (lignes à NIR et fixtures PayFit à NIR) |
| rule-evp-matching-rates-slots, -three-parts | Remplacées : v4-matching-rates ne garde que les droits, les états et la lecture seule |

## Non observable par l'API

- Conversion des données d'avant la v5 par la migration (`employee_company_id = company_id` pour les rattachées, `AUCUN` devenu `INCONNU`, contraintes de cohérence) : appliquée avant les tests ; TPE ne vérifie que ses effets (créneaux `NOM`, `INCONNU` ou par défaut posés en SQL rendent les taux indisponibles).
- Le test unitaire de `nir.ts` : appartient au développeur, la fonction n'a pas d'accès direct par l'API.
- L'affichage de l'écran des sources (libellés, liste, états vides) : tests Playwright de `acceptance/e2e/`, hors de ce fichier.
- Le format réel de `scope` chez PayFit : supposé (chaîne de portées séparées par des espaces ou tableau), à confirmer au premier essai réel.

## Effets sur les suites précédentes

La demande dit que les tests fondés sur le prénom et le nom sont réécrits par QA et que le test instable de la v4 est corrigé par QA. Modifications en place :
- `acceptance-v4-matching-rates.test.ts` : le test « only GET exists on the path… » attend maintenant la fin de l'exécution lancée par `POST /sources/aqoona/refresh` (`waitRun`), sans rien changer à ce qu'il vérifie ; les tests de forme à trois parts, de mode `NOM` et de contrat sont retirés (remplacés par TPE) ; la liste des chemins de `/sources` compte `unlinked-people`.
- `acceptance-v2-sources-state.test.ts` : liste des chemins ; `introspectScopes` pour que la portée manquante du faux PayFit ne trouble pas la suite.
- `acceptance-v2-sources-payfit.test.ts` : idem ; réintrospection à chaque lecture.
- `acceptance-v2-sources-aqoona.test.ts`, `acceptance-evp-sources.test.ts` : plus de collaboratrice rattachée par le nom.
- `acceptance-v3-nir-siret.test.ts`, `acceptance-v3-contracts.test.ts`, `acceptance-v3-sources-aqoona.test.ts`, `acceptance-v4-nir-key.test.ts`, `acceptance-v4-sources-payfit-scope.test.ts` : réécrits pour le rattachement par le NIR seul, les modes `NIR`/`AUCUN`, les nouveaux textes et la société nommée.

## Hypothèses

- Le mode stocké d'une ligne non reliée est `AUCUN` (plan de module : « la lecture écrit `NIR` ou `AUCUN` seulement »).
- Libellés et détails : voir `v5-helpers.ts` (`CAUSE_LABELS`, `unmatchedDetail`, `AQ_SCOPE_DETAIL`, `PF_SCOPE_DETAIL`…). Les tests comparent ces textes exactement ; un écart de rédaction avec la demande sera un test rouge à arbitrer, pas à contourner.
- Un nom de personne est comparé à la casse, aux accents et aux espaces près (`sameName`).
- Un NIR trouvé dans une société lisible est rattaché même si une autre société est illisible (D-0021 ne vise que « NIR introuvable »).
- L'ordre des causes n'est affirmé que pour `NIR_ABSENT` en premier.

## Besoins de contrat

`specifications/contract-changes.yaml` est en lecture seule pour cette session. Changements à y inscrire par QA : nouvelle opération `GET /sources/aqoona/unlinked-people` ; réponse de `GET /sources/aqoona/matching-rates` (parts `linked` / `unlinked` en personnes à la place de `byNir` / `byName` / `unmatched`) ; nouveaux types d'anomalie (`aqoona_no_identity`, `payfit_scope_missing`, `payfit_introspection_failed`) ; `specifications/openapi.json` est le contrat de référence et reste à régénérer par QA après la livraison.
