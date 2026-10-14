# Module evp : plan de réalisation (v4-evp-fiabilite-nir)

Sources : `sources-api-modification-request.md`, `sources-page-implementation-plan.md`, `questions.yaml` de ce dossier et la demande d'origine « v4 : EVP, fiabilité du rapprochement par NIR ». Le socle est gelé ; tout le code va dans la fonctionnalité EVP non gelée `sources/` (et `evp-core/redact-secrets.ts` si un masquage doit être complété). La provenance de chaque règle est reprise telle que la demande la porte (`user`, `inferred`) ; les règles que le backend ajoute pour réaliser une règle amont sont marquées `(inferred, backend)`.

**Une route nouvelle** : `GET /sources/aqoona/matching-rates`. Les autres routes gardent leur chemin, leur déclaration d'accès et la forme de leurs réponses. Un changement de comportement : l'anomalie `aqoona_nir_unavailable` apparaît aussi quand la portée PayFit manque, et deux types d'anomalies s'ajoutent. Aucune variable d'environnement nouvelle. Pas de rupture de contrat.

Réponses retenues pour les points ouverts : celles du registre `../../arbitrages.yaml` (Q-EVP-14 A, D-0018 (propriétaire) ; Q-EVP-15 A, D-0015 ; Q-EVP-16 A, D-0016 ; Q-EVP-17 A, D-0017 ; Q-EVP-18 A, D-0019 (les quatre dernières par défaut)).

## Réutilisation de l'existant (à lire avant d'écrire)
- `sources/nir.ts` : `canonicalNir()` (15 caractères), `payfitNirKey()` (13 ou 15), `looksLikeNir()`. Le calcul de clé s'y ajoute (fonction pure, ne journalise rien).
- `sources/source-readers.ts` `applyAqoona()` : une seule passe sur les lignes de la fenêtre ; c'est là que le mode de rattachement, les anomalies de clé et la demande des NIR se décident. Pas de seconde passe ni de second rapprochement.
- `sources/clients/payfit.client.ts` : `context()` / `companyId()` (introspection `POST` déjà faite pour l'identifiant de société, `CompanyIdLookup`) et `readNirs()`. L'introspection se factorise dans `context()` (une méthode qui renvoie `company_id` et `scope` de la même réponse) ; `companyId()` et `readNirs()` l'appellent : pas de second `POST` ni de second analyseur de réponse. Le `Map<siret, NirTable | null>` de `PayfitNirs` devient un résultat qui distingue les causes (voir « Changements internes »).
- `sources/source-connectors.ts` : `FakeSourceConnectors.listPayfitNirs()` et `nirUnavailable` ; `RealSourceConnectors.listPayfitNirs()`.
- `sources/sources.service.ts` `list()` : source de `lastReadAt` et de la fenêtre déjà servis par `GET /sources` pour Aqoona ; la nouvelle route les lit au même endroit.
- `sources/sources.controller.ts` : `CapabilityGuard('sources:read')`, `@Access({ action, roles: ['user'] })`, `@ApiRoute`.
- `evp-core/redact-secrets.ts` : `maskNirs()` et `redactSecrets()`, appliqués à tout texte d'anomalie construit à partir d'un nom.

## Données
Une colonne ajoutée à `base.aqoona_plannings` (`sources.tables.ts`, table de la fonctionnalité, hors `data-contract.md`) :

| Colonne | Type | Contrainte |
|---|---|---|
| `match_method` | texte | non nul, défaut `'INCONNU'`, `check (match_method in ('NIR','NOM','AUCUN','INCONNU'))` nommée `aqoona_plannings_match_method_check` |

- Les lignes existantes prennent `INCONNU` par le défaut de la migration ; la lecture d'Aqoona écrit toujours `NIR`, `NOM` ou `AUCUN`. Les lignes d'une adresse en échec sont conservées (`rule-evp-sources-partial-failure`) avec leur mode, `INCONNU` comprise.
- Aucune colonne ne porte de NIR, d'empreinte, de fragment ou de clé (`rule-evp-aqoona-nir-never-stored`, `rule-evp-nir-key-never-shown`). Aucune table de taux ; les anomalies restent dans la table existante, remplacée à chaque lecture.
- `aqoona_plannings_slot_unique` ne change pas (le mode n'en fait pas partie) ; le créneau dédoublonné garde le mode de la première ligne retenue.
- Pas d'index sur `company_id` : le calcul est un `group by` sur la fenêtre de lecture.
- Migration : modifier `sources.tables.ts`, puis `cd api && pnpm migrate:gen && pnpm migrate:all`, avant le redémarrage du serveur. Si QA y voit une extension du schéma `base`, la fabrication ouvre `OPEN: contract data-contract : match_method sur aqoona_plannings` dans `DISPUTES.md` de ce dossier.
- Aucun périmètre (row-level scopes) : la table reste réservée à la capacité `sources:read`.

## Opérations

### `GET /sources/aqoona/matching-rates` (nouvelle)
- Accès : `@UseGuards(CapabilityGuard('sources:read'))`, `@Access({ action: 'sources:matching-rates', roles: ['user'] })`. Même garde que `GET /sources` : RH et superadmin ; autres rôles `403`, sans session `401`, corps `{ status, code, message }`. Déclarée avant `:key/anomalies` dans le contrôleur, par prudence ; `GET` seul, ni paramètre ni requête.
- Sortie : `sourceAqoonaMatchingRatesSchema` (id OpenAPI `SourceAqoonaMatchingRatesDto`) dans `sources.schemas.ts`, bornes exactement celles de la demande :
  - `available` booléen ; `lastReadAt` date-heure ou nul ; `windowFrom`, `windowTo` dates `AAAA-MM-JJ` ou nulles ;
  - `items` au plus 200 éléments `{ companyId: 1..100 | null, siret: 1..20 | null, name: 1..200, total: entier >= 1, byNir | byName | unmatched: { count: entier >= 0, percent: nombre 0..100 } }`.
- Calcul (`SourcesService`, un `select ... group by company_id, match_method` sur `aqoona_plannings`, puis jointure en mémoire avec `payfit_companies` pour `name` et `siret`) :
  1. `lastReadAt` nul (jamais lue avec succès) : `available: false`, `items: []`, fenêtre nulle.
  2. Au moins un créneau `INCONNU` : `available: false`, `items: []`, `lastReadAt` et fenêtre renseignées (decision D-0016).
  3. Sinon `available: true`. Une ligne par `company_id` non nul présent dans `payfit_companies` ; les créneaux dont `company_id` est nul, ou dont la société n'existe plus dans `payfit_companies`, forment la dernière ligne `companyId: null`, `siret: null`, `name: "Sans société identifiée"` (decision D-0015).
  4. `total` = somme des trois effectifs ; `percent` = `round(100 × count / total, 1)` calculé en code, jamais en SQL ; effectifs exacts.
  5. Tri : `name` croissant en comparaison française (`Intl.Collator('fr', { sensitivity: 'base' })`), puis `companyId` ; ligne sans société en dernier.
- Erreurs : `401`, `403` seuls (aucune entrée à valider). Aucune trace d'audit : lecture seule, comme `GET /sources`.
- Contenu : identifiant, SIRET et nom de société, effectifs et pourcentages ; ni NIR, ni clé d'API, ni adresse, ni nom de collaboratrice.

### `GET /sources/{key}/anomalies` (forme inchangée)
`type`, `label`, `subject`, `detail` restent des chaînes aux mêmes bornes. Types servis pour `aqoona` en plus de ceux de la v3 (créés dans `applyAqoona()`, remplacés à chaque lecture par `replaceAnomalies`) :

| Type | `label` | `subject` | `detail` |
|---|---|---|---|
| `aqoona_nir_key_invalid` | Clé de NIR Aqoona incorrecte | « Prénom NOM » de la ligne (nettoyé, 1..100) | « N créneau(x) : la clé de contrôle du NIR est incorrecte, le prénom et le nom sont utilisés. » |
| `payfit_nir_key_invalid` | Clé de NIR PayFit incorrecte | « Prénom NOM » lu dans `payfit_employees`, à défaut « Collaboratrice <identifiant PayFit> » | « Société <SIRET> : la clé de contrôle du NIR est incorrecte, ce NIR n'est pas utilisé. » |
| `aqoona_nir_unavailable` | Rapprochement par NIR indisponible | SIRET | portée manquante : « La portée « collaborators:social-security:read » manque à la clé PayFit. Les noms sont utilisés à la place du NIR. » ; autre cause : « Les noms sont utilisés à la place du NIR. » |

### Autres routes
`GET /sources`, `POST /sources/{key}/refresh`, `POST /sources/refresh-all`, `GET /sources/runs/{id}` : inchangées. Les volumes d'Aqoona gardent leurs trois libellés et leur définition. La lecture d'Aqoona n'est jamais `PARTIAL` ni `FAILED` à cause d'une portée manquante ou d'une clé de NIR fausse.

### Changements internes (pas de route)
1. **Clé de contrôle** (`nir.ts`) : `nirKeyIsValid(nir15)` remplace `2A`/`2B` par `19`/`18` dans les 13 premiers caractères, calcule `N mod 97` en `BigInt` (le nombre dépasse 2^53), attend `97 − reste` sur deux chiffres, clé `00` toujours fausse. Retour booléen uniquement : la clé attendue n'est jamais exposée.
2. **Portée** (`payfit.client.ts`) : `readNirs()` fait une introspection par société à chaque appel (jamais servie du cache `CompanyIdLookup`, qui reste utilisé par la lecture complète de PayFit) et prend `company_id` dans cette même réponse (un seul `POST` par société) ; on lit `active` et `scope` (chaîne séparée par des espaces, ou tableau de chaînes ; comparaison exacte à `collaborators:social-security:read`). Résultat par SIRET : `{ status: 'ok', table, invalid }`, `{ status: 'scope-missing' }` ou `{ status: 'unavailable' }` (clé absente de `PAYFIT_API_KEYS`, `active: false`, réseau, `401/403/429/5xx`, format inattendu). Pour `scope-missing`, aucun `GET` des collaborateurs. La clé d'API reste enregistrée dans `registerSecret()` ; aucune réponse d'introspection n'est journalisée.
3. **Côté PayFit** : un NIR de 15 caractères à clé fausse n'entre pas dans `NirTable` ; la collaboratrice est consignée dans `invalid` (identifiant seulement, jamais la valeur). Un NIR de 13 caractères reste utilisé, sans anomalie.
4. **Côté Aqoona** (`applyAqoona()`) : une ligne dont `canonicalNir(row.matricule)` est présent mais de clé fausse est traitée comme une ligne sans NIR (rapprochement par noms ; l'ensemble `wanted` de `rule-evp-aqoona-nir-lazy` n'est calculé qu'avec les NIR de clé juste, donc elle ne provoque pas la demande des NIR de sa société) et compte pour l'anomalie `aqoona_nir_key_invalid` de la personne (`normalise()` pour regrouper ; nombre de créneaux dédoublonnés dans le détail). `matchMethod` est calculé dans la même passe : `NIR` si `matchedByNir`, `AUCUN` si `employeeId` nul, `NOM` sinon. La valeur du NIR n'est jamais passée à `report()`, aux anomalies, à un message ou à un logger.
5. **Fixtures `fake`** : `payfit.json` accepte `nirScopeMissing` (liste de SIRET, distinct de `nirUnavailable`) ; les NIR fictifs des fixtures reçoivent une clé juste (vecteurs de `rule-evp-nir-key-vectors`) sauf ceux qui éprouvent la clé fausse. Aucun vrai NIR dans le dépôt.
6. **Pilote `real`** : le format de `scope` est supposé ; à confirmer au premier essai réel, comme `PAYFIT_NIR_FIELD`.

## Règles
### Portée PayFit vérifiée
- `rule-evp-payfit-scope-checked` (user) : `payfit.client.ts` `readNirs()` lit `scope` avant tout `GET` des collaborateurs.
- `rule-evp-payfit-scope-format` (inferred) : fonction pure `hasNirScope(body)` ; `scope` absent, vide ou sans la portée vaut portée manquante ; `active: false`, réseau, `401/403/429/5xx` valent société illisible.
- `rule-evp-payfit-scope-fresh` (inferred) : `readNirs()` n'utilise pas `lookup` pour la portée ; `rule-evp-payfit-company-id` inchangée.
- `rule-evp-payfit-scope-missing-fallback` (user) : `applyAqoona()` crée `aqoona_nir_unavailable` (sujet SIRET) pour chaque société dont le résultat n'est pas `ok` et rapproche par noms ; lecture ni `PARTIAL` ni `FAILED`. `rule-evp-aqoona-nir-unavailable` inchangée dans le reste.
- `rule-evp-payfit-scope-detail` (inferred) : le détail se choisit selon le statut (`scope-missing` ou autre).
- `rule-evp-payfit-scope-coverage` (inferred, decision D-0019) : `wanted` reste l'ensemble des sociétés ayant une ligne à NIR de clé juste ; une société sans ligne Aqoona à NIR n'est pas interrogée et ne produit aucune anomalie.
- `rule-evp-payfit-scope-read-only` (inferred) : l'introspection reste le seul `POST` ; aucune portée n'est demandée par le code.

### Clé de contrôle du NIR
- `rule-evp-nir-key-formula` (user) : `nir.ts` `nirKeyIsValid()`.
- `rule-evp-nir-key-vectors` (inferred) : tests unitaires de `nir.ts` sur les vecteurs de la demande et la clé `00`.
- `rule-evp-nir-key-both-sides` (user) : `applyAqoona()` (Aqoona) et `readNirs()` (PayFit) appellent la même fonction.
- `rule-evp-nir-key-absent-ok` (inferred) : un NIR PayFit de 13 caractères n'est pas contrôlé et ne produit aucune anomalie.
- `rule-evp-nir-key-invalid-unused` (user) : ligne Aqoona traitée comme sans NIR ; collaboratrice PayFit retirée de `NirTable` (ne rend pas ambigu un NIR valide d'une autre).
- `rule-evp-nir-key-never-shown` (user) : aucun NIR à clé fausse dans réponse, anomalie, journal, audit, notification ; les textes d'anomalie passent par `maskNirs()`.
- `rule-evp-nir-key-anomaly-grain` (inferred) : une anomalie par personne distincte (`normalise()`).
- `rule-evp-nir-key-no-failure` (inferred) : les anomalies de clé n'altèrent ni `partial` ni le stockage.
- `rule-evp-nir-key-payfit-anomaly-source` (inferred, decision D-0018) : `payfit_nir_key_invalid` produite par `applyAqoona()` pour les seules sociétés lues, signalée dans les anomalies d'Aqoona ; la lecture PayFit ne lit toujours aucun NIR.
- `rule-evp-nir-key-anomaly-without-company` (inferred, backend, decision D-0017) : une ligne Aqoona de clé fausse donne l'anomalie même si l'établissement ne désigne aucune crèche unique.

### Stockage
- `rule-evp-aqoona-nir-never-stored` (user, inchangée) : `match_method` ne contient que `NIR`, `NOM`, `AUCUN`, `INCONNU`.
- `rule-evp-matching-method-first-row` (inferred, backend) : le créneau dédoublonné garde le mode de la première ligne retenue.

### Taux de rattachement
- `rule-evp-matching-rates-route` (user) : `GET /sources/aqoona/matching-rates`.
- `rule-evp-matching-rates-same-rights` (user) : `CapabilityGuard('sources:read')`.
- `rule-evp-matching-rates-three-parts` (inferred) : un créneau dans une seule part, selon `match_method`.
- `rule-evp-matching-rates-company` (inferred) : société = `company_id` ; nom et SIRET de `payfit_companies`.
- `rule-evp-matching-rates-no-company` (inferred, decision D-0015) : dernière ligne « Sans société identifiée ». Aussi pour une société absente de `payfit_companies` (inferred, backend : le nom exigé ne peut être inventé).
- `rule-evp-matching-rates-live` (inferred) : calcul à la demande, sans agrégat stocké.
- `rule-evp-matching-rates-consistency` (inferred) : somme des totaux = « Plannings lus » ; somme de `byNir.count` = « Rapprochés par NIR » ; `byNir + byName` = « Plannings rattachés » (decision D-0015) ; ces égalités valent après une lecture sans adresse en échec : les créneaux conservés d'une adresse en échec sont dans le tableau mais pas dans les volumes de la lecture.
- `rule-evp-matching-rates-unknown-mode` (inferred, backend, decision D-0016) : un créneau `INCONNU` rend toute la réponse `available: false`.
- `rule-evp-matching-rates-percent` (inferred) : arrondi à une décimale, en code.
- `rule-evp-matching-rates-no-nir` (user) : schéma de réponse sans champ nominatif.
- Inchangées : `rule-evp-aqoona-nir-lazy`, `-over-name`, `-fallback-name`, `-ambiguous`, `-format`, `-transient-key`, `rule-evp-sources-guard`, `rule-evp-sources-readonly`, `rule-evp-secrets-never-exposed`, et toutes celles des plans de la v1 à la v3 non citées ici.

## Tests
Jest dans `api/src/features/sources/tests/`, API de test, pilote `fake`, tables vidées en `beforeEach`. Chaque test cite sa règle. La suite d'acceptation est à QA.

- `nir.test.ts` (unitaire) : `nirKeyIsValid()` sur les vecteurs de `rule-evp-nir-key-vectors` (`1 84 12 76 451 089 46` juste, `...47` faux, `2A` et `2B`, clé de `2B` fausse pour `2A`), clé `00`, séparateurs, grand nombre sans perte de précision.
- `payfit-scope-units.test.ts` : `hasNirScope()` (chaîne, tableau, vide, absent, portée voisine, `active: false`). `PayfitClient.readNirs()` avec un `SourceHttp` factice injecté (le constructeur l'accepte) : une introspection par appel même quand l'identifiant est en cache (`rule-evp-payfit-scope-fresh`) ; portée manquante : aucun `GET` des collaborateurs et résultat `scope-missing` (`rule-evp-payfit-scope-checked`) ; `active: false`, `401/403/429/5xx`, clé absente, format inattendu : `unavailable` ; NIR PayFit de clé fausse absent de la table et consigné dans `invalid` sans valeur ; NIR de 13 caractères gardé ; le seul `POST` émis est l'introspection (`rule-evp-payfit-scope-read-only`).
- `GET /sources/aqoona/matching-rates` :
  - nominal : créneaux NIR, noms, aucun dans deux sociétés ; effectifs, pourcentages, tri français, ligne sans société en dernier ; somme des totaux égale à « Plannings lus » de `GET /sources` ;
  - jamais lue : `available: false`, `items: []` ; créneau `INCONNU` posé en SQL : `available: false` ; lue sans créneau : `available: true`, `items: []` ;
  - après une lecture : mode écrit (`NIR` / `NOM` / `AUCUN`, jamais `INCONNU`), doublon avec le mode de la première ligne (`rule-evp-matching-method-first-row`) ; NIR de clé fausse puis noms : `NOM` ; NIR ambigu : `AUCUN` ;
  - société absente de `payfit_companies` : créneaux dans la ligne « Sans société identifiée » ; pourcentage arrondi à une décimale avec effectifs exacts (1 sur 3 : 33,3) ; lecture avec une adresse en échec : créneaux conservés comptés dans le tableau ;
  - droits : RH et superadmin `200` ; directrice, RO, administratrice `403` ; sans session `401` ;
  - confidentialité : aucune valeur d'apparence NIR ni nom de collaboratrice dans la réponse.
- Anomalies d'Aqoona :
  - portée manquante (`nirScopeMissing`) : anomalie avec le détail de la portée, rapprochement par noms, lecture `SUCCESS` (ni `PARTIAL` ni `FAILED`), sujet = SIRET ; portée accordée entre deux lectures (fixture modifiée) : l'anomalie disparaît à la lecture suivante et le rapprochement repasse par NIR ; société illisible (`nirUnavailable`) : détail court ; société sans ligne à NIR : aucune anomalie (decision D-0019) ;
  - clé fausse côté Aqoona : une anomalie par personne (plusieurs créneaux et deux crèches : une seule anomalie) avec le nombre de créneaux, `match_method = NOM`, société non interrogée si seule cette ligne portait un NIR ; établissement inconnu : anomalie aussi (decision D-0017) ;
  - clé fausse côté PayFit : sujet « Prénom NOM » (à défaut « Collaboratrice <identifiant> ») ; anomalie dans les anomalies d'Aqoona et pas dans celles de PayFit (decision D-0018) ; la collaboratrice n'est trouvée que par ses noms ; elle ne rend pas ambigu un NIR valide d'une autre ;
  - NIR PayFit de 13 caractères : utilisé, sans anomalie ;
  - aucune valeur de NIR (fautif ou non) dans les anomalies, volumes, journal d'audit, journal du serveur et corps d'erreur.
- Contrat : l'OpenAPI contient la nouvelle opération et son schéma aux bornes de la demande ; `cuisine:routes` la déclare `auth`, action `sources:matching-rates`.
- Migration : les lignes existantes prennent `INCONNU` ; la contrainte `check` refuse une autre valeur.
