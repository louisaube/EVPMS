# Couverture des règles : version v4-evp-fiabilite-nir (EVP : portée PayFit vérifiée, clé de contrôle du NIR, taux de rattachement)

Version suivante de `v3-evp-acces-contrats-siret`. Tests écrits avant tout code, d'après la demande d'origine de la version, la demande à l'API (`sources-api-modification-request.md`), le plan de module et le plan d'écran de `specifications/evp/implementation-plans/v4-evp-fiabilite-nir/`, `questions.yaml` de ce dossier et les décisions actives de `specifications/evp/arbitrages.yaml` (D-0015 à D-0019). Les tests des versions précédentes ne sont pas modifiés.

| Sigle | Fichier | Variante d'API |
|---|---|---|
| TAU | `acceptance-v4-matching-rates.test.ts` (`GET /sources/aqoona/matching-rates` : droits, états, calcul, tri, pourcentages, confidentialité ; colonne `match_method` ; contrat OpenAPI) | `fake` (défaut) |
| CLE | `acceptance-v4-nir-key.test.ts` (clé de contrôle des deux côtés, anomalies, portée par le pilote `fake` via `nirScopeMissing`, mode stocké, aucun NIR visible) | `fake` (défaut) |
| POR | `acceptance-v4-sources-payfit-scope.test.ts` (introspection PayFit réelle : champ `scope`, une introspection par société et par lecture, formats de `scope`, causes « société illisible », clé de contrôle des NIR livrés par PayFit, taux face à une lecture réelle) | `nir` (nouvelle) |

Aides : `v4-helpers.ts` (NIR fictifs à clé juste et à clé fausse, créneaux posés en SQL avec leur mode, lecture des taux, aides de contrat OpenAPI, réglage de la réponse d'introspection du faux PayFit, recherche d'un NIR dans tout ce que l'API montre ou stocke) ; elle réutilise `evp-helpers.ts`, `v2-helpers.ts` et `v3-helpers.ts` sans les modifier.

Le titre de chaque test commence par le ou les identifiants de règle entre crochets, puis, pour les décisions, `[D-xxxx]`. Pour retrouver les tests d'une règle : `jest -t "\[rule-evp-<slug>\]"`.

## Variante d'API déclarée (`acceptance/variants.yaml`)

Les fichiers TAU et CLE tournent contre la variante par défaut `fake` : aucune source externe, PayFit et Aqoona sont lus dans `api/.evp-fixtures-test/payfit.json` et `aqoona.json`. Le fichier POR tourne contre la variante **`nir`** (nouvelle), qui ne modifie aucune variante existante :
- pilote `real` ; serveurs factices démarrés par les tests sur les ports locaux 4501 (Google), 4502 (Sheets), 4503 (PayFit, introspection comprise) et 4511 (Aqoona « Pros »), propres à la variante ;
- `PAYFIT_API_KEYS` : deux clés (SIRET `11111111111111` et `22222222222222`, comme `seedWorld()`) ; `PAYFIT_INTROSPECT_URL` : `http://127.0.0.1:4503/introspect`. Le faux PayFit répond à l'introspection avec `active`, `company_id` et le `scope` que chaque test règle (`introspectScopes()`) ;
- `AQOONA_URLS` : l'adresse « Pros » unique, mêmes principes que la variante `pros` de la v3 (dates périmées à remplacer, `lang` et `securityCheck` à conserver) ; `AQOONA_MAPPING_FILE` : `acceptance/fixtures/aqoona-mapping-pros.test.json` (inchangé, non modifié par la v4) ;
- aucune variable à écrire par les développeurs dans `api/.env.test` : tout vient de la variante ; les tests lisent l'environnement dans le fichier désigné par `ACCEPTANCE_ENV_FILE`.

## Décisions actives de la version

| Décision | Question | Choix | Épreuve (titre) |
|---|---|---|---|
| D-0015 | Q-EVP-15 | A (ligne « Sans société identifiée ») | TAU `[rule-evp-matching-rates-no-company][D-0015] two slots, one from an establishment unknown of the referential and one attached by NIR to a collaborator of Alpha…` (`GET /sources/aqoona/matching-rates` : Alpha total 1 / `byNir.count` 1, ligne `companyId` nul total 1 / `unmatched.count` 1) |
| D-0016 | Q-EVP-16 | A (aucun taux tant qu'un mode est inconnu) | TAU `[rule-evp-matching-rates-unknown-mode][D-0016] a slot of unknown mode stored among slots of mode NIR and NOM…` (créneau `INCONNU` posé en SQL parmi des créneaux `NIR` et `NOM` : `200`, `available false`, `items` vide) |
| D-0017 | Q-EVP-17 | A (clé fausse signalée même sans crèche identifiée) | CLE `[rule-evp-nir-key-anomaly-without-company][D-0017] a row with a wrong key whose establishment is unknown…` (`GET /sources/aqoona/anomalies` : « Clé de NIR Aqoona incorrecte » et « Planning non rattaché ») |
| D-0018 | Q-EVP-14 | A, par le propriétaire (clé fausse PayFit signalée sur Aqoona) | CLE `[rule-evp-nir-key-payfit-anomaly-source][D-0018] a collaborator of Alpha carries a NIR with a wrong key in PayFit…` (lectures PayFit puis Aqoona : l'anomalie « Clé de NIR PayFit incorrecte » est dans `GET /sources/aqoona/anomalies`, aucune dans `GET /sources/payfit/anomalies`) |
| D-0019 | Q-EVP-18 | A (contrôle de portée seulement pour les sociétés lues) | CLE `[rule-evp-payfit-scope-coverage][D-0019] Alpha lacks the scope and no Aqoona row of its crèches carries a NIR…` (`GET /sources/aqoona/anomalies` : aucune anomalie « Rapprochement par NIR indisponible » pour le SIRET d'Alpha) ; POR `[rule-evp-payfit-scope-coverage] a key without the scope for a company that has no Aqoona row with a NIR is not even introspected…` (même cas avec le pilote réel : zéro introspection pour Alpha) |

## Règles de la version : table de couverture

Légende : « Non observable » = aucune observation par l'API, HTTP ou SQL, ne peut prouver la règle ; la raison est donnée.

### Portée PayFit vérifiée

| Rule id | Couverture |
|---|---|
| rule-evp-payfit-scope-checked | POR (la portée est lue dans l'introspection avant tout `GET` des collaborateurs : zéro `GET …/collaborators` pour une société sans la portée, lu pour celle qui l'a ; un seul `POST` d'introspection par société et par lecture, clé en `Bearer` ; aucun appel du tout sans ligne à NIR de clé juste) ; CLE (pilote `fake` : NIR non utilisés pour une société en `nirScopeMissing`) |
| rule-evp-payfit-scope-format | POR (chaîne de portées séparées par des espaces, y compris espaces multiples en bordure ; tableau de chaînes ; comparaison exacte : `scope` absent, vide, blanc, `null`, tableau vide, portée voisine, préfixe, suffixe `:all`, `:readonly`, casse différente = portée manquante ; `active: false`, `401`, `403`, `429`, `500`, `503` = société illisible avec la phrase courte, lecture `SUCCEEDED`, jamais `PARTIAL`). Le cas d'un corps d'introspection 200 sans `active` ni `company_id` n'est pas rejoué : la demande ne dit pas s'il vaut « portée manquante » ou « format inattendu » |
| rule-evp-payfit-scope-fresh | POR (après une lecture complète de PayFit qui a rempli le cache d'identifiant : une introspection à chaque lecture d'Aqoona ; portée retirée puis rendue entre deux lectures, vue à la lecture suivante, rattachement par NIR rétabli) ; CLE (pilote `fake` : anomalie remplacée et non cumulée, portée accordée puis retirée) |
| rule-evp-payfit-scope-missing-fallback | CLE, POR (anomalie `aqoona_nir_unavailable` « Rapprochement par NIR indisponible », sujet = SIRET ; rattachement par noms ; NIR présents dans la réponse non utilisés ; lecture `SUCCEEDED`, état de la source `UP_TO_DATE`, ni `FAILED` ni `PARTIAL` ; volume « Rapprochés par NIR » à 0 pour la société ; trois libellés de volumes inchangés) |
| rule-evp-payfit-scope-detail | CLE, POR (phrase « La portée « collaborators:social-security:read » manque à la clé PayFit. Les noms sont utilisés à la place du NIR. » pour la portée ; phrase courte pour `nirUnavailable`, `active: false`, `401/403/429/5xx` et clé absente de `PAYFIT_API_KEYS` ; les deux dans une même lecture pour deux sociétés) |
| rule-evp-payfit-scope-coverage | CLE `[D-0019]` (société sans ligne à NIR : aucune anomalie ; aucune ligne à NIR du tout : aucune société signalée) ; POR (zéro introspection pour la société sans ligne à NIR) ; CLE, POR (une société qui n'a que des lignes à NIR de clé fausse n'est pas interrogée : aucun appel, aucune anomalie ; dès qu'une ligne a une clé juste, elle l'est) |
| rule-evp-payfit-scope-read-only | POR (tous les appels à PayFit sont des `GET`, sauf le `POST` d'introspection ; ni contrats ni absences lus pour les NIR ; tables PayFit intactes). « Aucune portée n'est demandée par le code » : non observable (aucune requête d'autorisation n'existe dans la lecture) |

### Clé de contrôle du NIR

| Rule id | Couverture |
|---|---|
| rule-evp-nir-key-formula | CLE (vecteurs de la demande par leurs effets : `…46` juste, `…47` faux ; `2A` → 19, `2B` → 18 ; reste 0 → clé 97 juste ; clé `00` toujours fausse ; formes avec espaces) |
| rule-evp-nir-key-vectors | CLE (les six vecteurs de la demande sont tous éprouvés par le rattachement qu'ils permettent ou refusent : `…46`, `…47`, `2A …38`, `2B …65`, `2A …65`). Le test unitaire de `nir.ts` est celui du développeur : la fonction n'a aucun accès direct par l'API |
| rule-evp-nir-key-both-sides | CLE, POR (même vérification côté Aqoona et côté PayFit ; même valeur fausse des deux côtés = pas de rattachement) |
| rule-evp-nir-key-absent-ok | CLE (NIR PayFit de 13 caractères : utilisé sur ses 13 premiers, aucune anomalie) ; POR (idem avec le faux PayFit) |
| rule-evp-nir-key-invalid-unused | CLE (ligne Aqoona à clé fausse : traitée comme sans NIR, rattachée par noms, mode `NOM`, volume « Rapprochés par NIR » à 0 ; ne provoque pas à elle seule l'interrogation de sa société ; collaboratrice PayFit à clé fausse introuvable par son NIR, trouvée par ses noms, sans rendre ambigu un NIR juste d'une autre) ; POR (mêmes cas contre le faux PayFit, zéro appel à PayFit pour des lignes à clé fausse seules) |
| rule-evp-nir-key-never-shown | CLE, POR, TAU (aucune forme — normalisée, avec espaces, 13 premiers chiffres, avec `2A`/`2B` — d'aucun NIR juste ou faux dans les réponses, anomalies, exécutions, volumes, exports, audit, notifications, taux, tables de `base` et journal du serveur ; aucun chiffre qui indique la clé dans les textes d'anomalie : seuls le décompte et le SIRET) |
| rule-evp-nir-key-anomaly-grain | CLE (une anomalie par personne distincte, regroupée par `normalise()` : casse, accents et espaces ; plusieurs créneaux, deux crèches, deux sociétés, ligne dupliquée ; le décompte des créneaux dédoublonnés est dans le détail) ; POR/CLE (une anomalie par collaboratrice côté PayFit) |
| rule-evp-nir-key-no-failure | CLE (lecture `SUCCEEDED`, source `UP_TO_DATE`, tous les créneaux stockés, rattachement par noms maintenu) |
| rule-evp-nir-key-payfit-anomaly-source | CLE `[D-0018]` ; CLE (sujet « Prénom NOM » lu dans `payfit_employees`, à défaut « Collaboratrice <identifiant PayFit> » ; la lecture de PayFit seule ne produit aucune anomalie de clé ; seule la société lue par Aqoona est contrôlée) ; POR (mêmes cas contre le faux PayFit) |
| rule-evp-nir-key-anomaly-without-company | CLE `[D-0017]` (« Clé de NIR Aqoona incorrecte » en plus de « Planning non rattaché », mode `AUCUN`) |

### Stockage

| Rule id | Couverture |
|---|---|
| rule-evp-aqoona-nir-never-stored (inchangée) | TAU (colonne `match_method` : texte, non nulle, défaut `INCONNU`, contrainte `aqoona_plannings_match_method_check` refusant toute autre valeur, y compris une valeur d'apparence NIR ; aucune autre colonne ne peut porter un NIR, une empreinte ou une clé ; valeurs écrites par une lecture : `NIR`, `NOM`, `AUCUN`, jamais `INCONNU`) ; CLE (mode `NIR` / `NOM` / `AUCUN` pour : NIR, noms, personne inconnue, NIR ambigu, établissement inconnu, clé fausse, valeur qui n'est pas un NIR ; chaque lecture remplace les modes) |
| rule-evp-matching-method-first-row | CLE (deux lignes du même créneau : le mode de la première ligne retenue, dans les deux ordres) |

### Taux de rattachement

| Rule id | Couverture |
|---|---|
| rule-evp-matching-rates-route | TAU (`200` avec exactement les cinq champs ; jamais lue : `available false`, dates nulles, `items` vide, même si des créneaux sont stockés ; lue sans créneau : `available true`, `items` vide, `lastReadAt` et fenêtre égaux à ceux de `GET /sources` ; `GET` seul : `POST`/`PUT`/`PATCH`/`DELETE` refusés ; n'ombrage ni `…/anomalies` ni `…/refresh` ; contrat OpenAPI) |
| rule-evp-matching-rates-same-rights | TAU (RH et SUPERADMIN `200` ; directrice, RO, ADMINISTRATRICE `403` avec `{ status, code, message }` et sans donnée ; sans jeton et jeton invalide `401` ; le document OpenAPI déclare `401` et `403` seuls) |
| rule-evp-matching-rates-three-parts | TAU (un créneau dans une seule part ; NIR ambigu → non rattaché ; clé fausse et société sans portée → par prénom et nom), POR (même chose après une lecture réelle) |
| rule-evp-matching-rates-company | TAU (société = `company_id` ; nom et SIRET de `payfit_companies` ; seules les sociétés qui ont un créneau ; deux crèches du même SIRET dans la même société ; tri en comparaison française sans casse ni accents puis par identifiant ; ligne sans société en dernier) |
| rule-evp-matching-rates-no-company | TAU `[D-0015]` (établissement inconnu : ligne `companyId` nul, `siret` nul, « Sans société identifiée ») ; TAU (créneaux sans `company_id` et créneaux d'une société absente de `payfit_companies` dans la même dernière ligne, l'identifiant disparu n'étant pas montré) |
| rule-evp-matching-rates-live | TAU (les taux suivent les créneaux stockés à l'instant ; une nouvelle lecture les remplace ; lecture seule : aucune entrée d'audit, aucune exécution, aucune notification, aucune table nouvelle, aucune table d'agrégats) |
| rule-evp-matching-rates-consistency | TAU (somme des `total` = « Plannings lus », somme des `byNir.count` = « Rapprochés par NIR », `byNir` + `byName` = « Plannings rattachés », vérifiées sur la réponse de l'exécution et sur `GET /sources`) ; POR. Le cas « adresse en échec » (créneaux conservés comptés dans le tableau mais pas dans les volumes) n'est pas rejoué avec une vraie lecture : les variantes de la v3 et de la v4 n'ont qu'une adresse Aqoona. Les créneaux stockés sont comptés quelle que soit la lecture qui les a écrits (TAU, créneaux posés en SQL) |
| rule-evp-matching-rates-unknown-mode | TAU `[D-0016]` (créneau `INCONNU` ou valeur par défaut parmi d'autres : `available false`, `items` vide, aucune quatrième part, `lastReadAt` et fenêtre conservés ; la lecture complète suivante remplace ces créneaux et rend les taux) |
| rule-evp-matching-rates-percent | TAU (`round(100 × count / total, 1)` calculé par l'API : 1/3 → 33,3 trois fois, 1/6 → 16,7, 5/6 → 83,3, 1/8 → 12,5, tout dans une part → 100 ; effectifs exacts ; contrat : `percent` de 0 à 100, `count` ≥ 0, `total` ≥ 1, `items` ≤ 200, bornes des identifiants, SIRET et nom) |
| rule-evp-matching-rates-no-nir | TAU (clés de la réponse limitées à celles du contrat ; aucun NIR ni prénom ni nom de collaboratrice, ni clé d'API, ni adresse ; journal du serveur et tables propres) ; POR |

### Écran Sources (plan d'écran)

| Rule id | Couverture |
|---|---|
| rule-evp-matching-rates-screen | Non observable par l'API : c'est l'affichage du tableau (nom accessible, colonnes, format `75,0 % (3)`, pied de section, note de lecture, trois états sans tableau, relecture après une lecture). Il relève des tests de navigateur (`acceptance/e2e/`), hors de ce périmètre. Les données qu'il affiche sont éprouvées par TAU. Display only: not observable through HTTP or SQL |
| rule-evp-matching-rates-slots | Données : TAU (un créneau stocké = une ligne dédoublonnée, `total` = somme des trois effectifs, sommes égales aux volumes). Affichage : voir ci-dessus. Display of the rates table: not observable through HTTP or SQL |
| rule-evp-nir-key-anomalies-visible | Données : CLE, POR (les deux types d'anomalie dans `GET /sources/aqoona/anomalies`, ni `PARTIAL` ni `FAILED`). Lisibilité dans le panneau : écran, non observable par l'API. Panel readability: not observable through HTTP or SQL |
| rule-evp-payfit-scope-missing-visible | Données : CLE, POR (anomalie de portée pour la société, dans les anomalies d'Aqoona, ni l'état de la clé ni la clé ne sont exposés : `GET /sources` ne montre pas la clé, `expectNoSecret`). Lisibilité : écran. Panel readability: not observable through HTTP or SQL |
| rule-evp-matching-rates-same-rights (écran) | Route refusée : TAU. « Accès refusé » à l'écran et absence d'appel : écran |
| Règles inchangées citées par les plans (`rule-evp-aqoona-nir-lazy`, `-over-name`, `-fallback-name`, `-ambiguous`, `-format`, `-transient-key`, `-nir-unavailable`, `rule-evp-sources-guard`, `-readonly`, `rule-evp-secrets-never-exposed`, `rule-evp-sources-partial-failure`) | Éprouvées par la v3 et la v1 ; rejouées ici là où la v4 les touche (CLE, POR). `rule-evp-sources-partial-failure` : voir `rule-evp-matching-rates-consistency` |

## Hypothèses retenues par la recette (à contester par un litige si elles gênent)

1. **Fixtures du pilote `fake`** : `payfit.json` porte le champ facultatif `nir` d'une collaboratrice (v3, D-0010), la liste `nirUnavailable` (v3) et la nouvelle liste `nirScopeMissing` (plan de module, « Fixtures `fake` ») ; le pilote `fake` applique à la valeur de `nir` la même vérification de clé que le pilote `real` (NIR de 15 caractères à clé fausse écarté et consigné, NIR de 13 caractères gardé).
2. **Sujet des anomalies de clé** : « Prénom Nom » tel que la v3 le montre (`person_ref` nettoyé, pas mis en majuscules ; ex. `Léa Martin`). Le détail côté Aqoona est comparé par expression régulière : « N créneau », « N créneaux » ou « N créneau(x) », puis « : la clé de contrôle du NIR est incorrecte, le prénom et le nom sont utilisés. ». Le détail côté PayFit est comparé tel que la demande l'écrit.
3. **Forme des taux** : `percent` est un nombre JSON (entier ou décimal) ; `companyId` d'une société PayFit est son identifiant de `payfit_companies` (ex. `co-a`).
4. **Table `aqoona_plannings`** : colonnes `person_ref`, `creche_code`, `company_id`, `employee_id`, `day`, `start_time`, `end_time`, `slot_type`, `address_label`, `match_method` (demande et plans v2/v3/v4). La recette pose des créneaux par SQL en ne nommant que ces colonnes (les autres colonnes non nulles reçoivent une valeur neutre) ; elle suppose qu'aucune clé étrangère n'impose qu'un `company_id` existe dans `payfit_companies` (la demande prévoit le cas d'une société qui n'existe plus). Le nom de la contrainte `check` (`aqoona_plannings_match_method_check`) est celui du plan de module.
5. **Fenêtre et dernière lecture** : seule l'égalité avec `GET /sources` est exigée ; les bornes (J−28, J+35) ne sont pas reprises ici.
6. **Portée** : un `scope` `null` ou une chaîne blanche vaut « vide » ; les espaces en bordure d'une chaîne sont ignorés ; une introspection `200` sans `active` ni `company_id` n'est pas éprouvée (voir `rule-evp-payfit-scope-format`).
7. **Lecture à une adresse en échec** : non rejouée avec une vraie lecture (voir `rule-evp-matching-rates-consistency`).

## Effets sur les suites des versions précédentes (aucun test précédent n'est modifié ici)

Litiges attendus des développeurs (`OPEN: <titre du test>` dans le `DISPUTES.md` du dossier de la version), à arbitrer par QA ; ces effets sont ceux que la demande annonce (« le test de la v3 qui pose un NIR PayFit à clé fausse ou qui suppose qu'une portée absente est sans anomalie est à revoir par QA ») :
- **v3 `acceptance-v3-nir-siret.test.ts` `[rule-evp-aqoona-nir-format]`** : le NIR fictif `NIR_2A` de `v3-helpers.ts` (`190052A12345612`) a une clé fausse selon la formule de la demande (la clé juste serait `79`) ; il n'est plus utilisé au rapprochement.
- **v3 `acceptance-v3-sources-aqoona.test.ts`** (variante `pros`) : l'introspection par défaut du faux PayFit de la v3 répond `scope: "collaborators:read contracts:read time:read"`, sans `collaborators:social-security:read`. Tous les tests qui attendent un rapprochement par NIR (`[rule-evp-aqoona-nir-transient-key]`, `[rule-evp-aqoona-nir-over-name]`, `[rule-evp-aqoona-nir-ambiguous][D-0014]`, deux contrats, `[rule-evp-aqoona-nir-never-stored]` avec le volume à 3), qui attendent un `GET …/collaborators` (`[rule-evp-aqoona-nir-lazy]`) ou la phrase courte pour une portée refusée (`[rule-evp-aqoona-nir-unavailable]`) voient désormais l'anomalie « portée manquante ».
- **v1/v3 `fake`** : les NIR fictifs `NIR1` à `NIR4` ont une clé juste (vérifiée à la main) : leurs tests restent valables.
- **v2** `acceptance-v2-sources-state.test.ts` `[rule-evp-sources-manual]` (« the operations of the sources keep their access ») exige la liste exacte des cinq chemins `/sources…` : elle est contredite par le chemin ajouté `/sources/aqoona/matching-rates` (la v4 en compte six, voir TAU, contrat) : litige attendu.

## Matrice des permissions

`specifications/permissions.yaml` :
- **Ajoutée** : `GET /sources/aqoona/matching-rates` (`sources:matching-rates`, `allow: []` comme les autres routes du groupe Sources — la matrice par rôle, RH et superadmin admis, directrice / RO / administratrice `403`, sans session `401`, est éprouvée par TAU —, `ownership: none`, règles `rule-evp-matching-rates-*`, `cross_owner_tests: []` : aucune ressource d'un autre utilisateur n'existe).
- **Modifiées** (règles de la version ajoutées) : `GET /sources` (`rule-evp-matching-rates-consistency`), `POST /sources/:key/refresh` (portée, clé de contrôle, mode du premier créneau), `GET /sources/:key/anomalies` (portée, clé de contrôle, anomalies).
- Accès (méthode, chemin, action, rôles, propriété) inchangés pour toutes les autres entrées.

## Contrat de référence

Changement de contrat annoncé par la demande, additif, à déclarer par QA sous `allowed:` de `specifications/contract-changes.yaml` si la porte de contrat le signale : opération `GET /sources/aqoona/matching-rates` et schéma `SourceAqoonaMatchingRatesDto`. Aucune opération existante ne change de forme. Ce fichier est en lecture seule pour QA dans cette étape ; il n'est pas modifié ici.

## Fichiers écrits

- `acceptance/v4-helpers.ts`
- `acceptance/variants.yaml` (variante `nir` ajoutée)
- `acceptance/acceptance-v4-matching-rates.test.ts`
- `acceptance/acceptance-v4-nir-key.test.ts`
- `acceptance/acceptance-v4-sources-payfit-scope.test.ts`
- `acceptance/COVERAGE-v4-evp-fiabilite-nir.md`
- `specifications/permissions.yaml` (entrée ajoutée, trois entrées mises à jour)
