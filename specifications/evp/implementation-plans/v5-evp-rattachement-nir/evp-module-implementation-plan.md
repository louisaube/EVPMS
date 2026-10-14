# Module evp : plan de réalisation (v5-evp-rattachement-nir)

Sources : `sources-api-modification-request.md`, `sources-page-implementation-plan.md`, `questions.yaml` de ce dossier et la demande d'origine « v5 : EVP, rattachement par le NIR seul, sur tout le réseau ». Le socle est gelé ; tout le code va dans la fonctionnalité EVP non gelée `sources/` (et `creches/creches.service.ts` pour une condition de requête). La provenance de chaque règle est reprise telle que la demande amont la porte (`user`, `inferred`) ; les règles que le backend ajoute pour réaliser une règle amont sont marquées `(inferred, backend)`.

**Une route nouvelle** : `GET /sources/aqoona/unlinked-people`. **Une route dont la forme change (rupture de contrat)** : `GET /sources/aqoona/matching-rates`. Les autres routes gardent chemin, déclaration d'accès et forme ; leur comportement change (anomalies, rattachement). Aucune variable d'environnement nouvelle. Le point 5 de la demande (test instable de la v4) est un test de QA : aucun changement d'API.

Choix tranchés : `questions.yaml` (Q-EVP-19 à Q-EVP-23), inscrits au registre `arbitrages.yaml` : D-0020 (Q-EVP-19, A), D-0021 (Q-EVP-20, B), D-0022 (Q-EVP-21, A), D-0023 (Q-EVP-22, A), D-0024 (Q-EVP-23, A). Les `resultat` et `test` des options retenues sont appliqués littéralement ci-dessous.

## Réutilisation de l'existant (à lire avant d'écrire)
- `sources/source-readers.ts` `applyAqoona()` : une seule passe sur les lignes de la fenêtre. C'est là que le rattachement, les causes et les anomalies se décident ; on réécrit le rapprochement dans cette passe, sans second rapprochement. La construction `staff` par société et `nameKey` ne sert plus au rattachement (elle reste pour afficher « Prénom NOM » d'une collaboratrice rattachée).
- `sources/nir.ts` : `canonicalNir()`, `payfitNirKey()`, `nirKeyIsValid()`, `looksLikeNir()` inchangés.
- `sources/clients/payfit.client.ts` : `context()` / `introspect()` (un seul analyseur de réponse d'introspection, `hasNirScope()`), `readNirs()`. La lecture complète de PayFit appelle aussi `introspect()`.
- `sources/source-connectors.ts` : `listPayfitNirs(sirets)`, pilote `fake` (`nirScopeMissing`, `nirUnavailable`) et `real`.
- `sources/sources.service.ts` : `list()` (dernière lecture et fenêtre), appel de `listPayfitNirs` (ligne ~410), enchaînement des lectures.
- `sources/sources.controller.ts` : `CapabilityGuard('sources:read')`, `@Access`, `@ApiRoute`. `sources.schemas.ts` : `anomaliesQuerySchema` (`evpPageShape(25)` de `evp-core/evp-query.ts`, paramètres `from` et `size`) et `evpPageOf()` pour la pagination de la liste : aucune pagination nouvelle. `ratePartSchema` est réutilisé pour `linked` et `unlinked`.
- `creches/creches.service.ts` (lignes ~62-67) : `not exists` sur `aqoona_plannings`.
- `evp-core/redact-secrets.ts` : `maskNirs()`, `redactSecrets()` appliqués à tout texte construit à partir d'un nom.

## Données
Colonnes ajoutées à `base.aqoona_plannings` (`sources.tables.ts`, table de la fonctionnalité, hors `data-contract.md`) :

| Colonne | Type | Contrainte |
|---|---|---|
| `employee_company_id` | texte | nul permis ; société PayFit de référence de la collaboratrice rattachée (peut différer de `company_id`, cas d'une volante) ; non nul si et seulement si `employee_id` est non nul |
| `unlinked_cause` | texte | nul permis ; `check` nommée `aqoona_plannings_unlinked_cause_check` : `NIR_ABSENT`, `NIR_KEY_INVALID`, `NIR_UNKNOWN`, `NIR_AMBIGUOUS`, `PAYFIT_INCOMPLETE` ; non nulle si et seulement si `employee_id` est nul et que la ligne a un nom ou un NIR |
| `creche_label` | texte | nul permis ; établissement tel que lu dans Aqoona, écrit pour un créneau non rattaché dont la crèche est inconnue du référentiel (nom d'établissement, jamais un NIR) |

- `match_method` : la contrainte `aqoona_plannings_match_method_check` garde `NIR`, `NOM`, `AUCUN`, `INCONNU` (`NOM` n'est plus écrit, il reste admis pour les lignes d'avant la v5). La lecture d'Aqoona écrit `NIR` ou `AUCUN` seulement.
- `company_id` du créneau reste la société de la crèche (par SIRET, v3) ; `aqoona_plannings_slot_unique` ne change pas. Le créneau dédoublonné garde les valeurs de la première ligne retenue (`rule-evp-matching-method-first-row`).
- Aucune colonne ne porte de NIR, d'empreinte ni de fragment (`rule-evp-aqoona-nir-never-stored`, user).
- Lignes existantes : colonnes nouvelles nulles, `match_method` inchangé ; les créneaux `NOM` et `INCONNU` (dont les anciens `AUCUN`) rendent les deux routes `available: false` jusqu'à une lecture complète d'Aqoona qui les remplace.
- Contrainte supplémentaire : `check` `aqoona_plannings_employee_company_check` (`employee_id` et `employee_company_id` tous deux nuls ou tous deux non nuls).
- Données existantes, dans le fichier SQL de la migration générée (complété à la main avant `migrate:all`) : `employee_company_id` = `company_id` pour les lignes à `employee_id` non nul (avant la v5 la collaboratrice était toujours de la société de la crèche, la requête de `creches.service.ts` continue donc de les voir) ; les lignes `AUCUN` d'avant la v5 passent à `INCONNU` (leur cause est inconnue et rien ne les distingue d'une ligne sans nom ni NIR : sans cela elles fausseraient les taux sans le dire). Les lignes `NIR` gardent `NIR`.
- `aqoona_mismatches` (aucune route ne la lit ; les tests de non-fuite de NIR la regardent) : toujours écrite pour chaque créneau non rattaché, avec `reason` = libellé de la cause (`UNLINKED_CAUSE_LABELS`), jamais un NIR.
- Migration : modifier `sources.tables.ts`, puis `cd api && pnpm migrate:gen && pnpm migrate:all`, avant le redémarrage. Si QA y voit une extension du schéma `base`, la fabrication ouvre `OPEN: contract data-contract : employee_company_id, unlinked_cause, creche_label sur aqoona_plannings` dans `DISPUTES.md` de ce dossier.
- Aucun périmètre (row-level scopes) : tables réservées à la capacité `sources:read`.
- Index : aucun nouveau ; le calcul des personnes se fait sur la fenêtre de lecture.

## Opérations

### `GET /sources/aqoona/matching-rates` (forme modifiée)
- Accès inchangé : `CapabilityGuard('sources:read')`, `@Access({ action: 'sources:matching-rates', roles: ['user'] })`. `401`, `403` seuls ; corps `{ status, code, message }`. Aucune trace d'audit.
- Sortie : `sourceAqoonaMatchingRatesSchema` (id `SourceAqoonaMatchingRatesDto`) remplace la forme de la v4 : `available`, `lastReadAt`, `windowFrom`, `windowTo`, `items` (au plus 200) `{ companyId: 1..100 | null, siret: 1..20 | null, name: 1..200, total: entier >= 1, linked: { count >= 0, percent 0..100 }, unlinked: { count >= 0, percent 0..100 } }`. Bornes exactement celles de la demande amont.
- Calcul (dans `SourcesService`, en mémoire à partir d'un `select` des colonnes utiles sur la fenêtre, jointure avec `payfit_companies`) :
  1. Jamais lue avec succès : `available: false`, `items: []`, fenêtre nulle.
  2. Au moins un créneau `NOM` ou `INCONNU` : `available: false`, `items: []`, `lastReadAt` et fenêtre renseignées.
  3. Sinon `available: true`. Personnes rattachées : paires distinctes `(employee_company_id, employee_id)`, comptées dans la ligne de `employee_company_id`. Personnes non reliées : « prénom nom » normalisé distinct (`normalise()`) parmi les créneaux à `unlinked_cause` non nulle, comptées une fois dans la ligne de la société de chaque crèche où elles ont été lues (`company_id` du créneau) ; `company_id` nul ou société absente de `payfit_companies` (de même pour un `employee_company_id` absent de `payfit_companies`) : ligne « Sans société identifiée » (`companyId`, `siret` nuls). Une personne non reliée de plusieurs sociétés compte dans chacune (`rule-evp-matching-rates-company-of-person`).
  4. `total = linked.count + unlinked.count` ; `percent = round(100 × count / total, 1)` en code ; une ligne seulement si `total >= 1`.
  5. Tri : `name` en comparaison française (`Intl.Collator('fr', { sensitivity: 'base' })`), puis `companyId` ; ligne sans société en dernier.
- Ne contient ni NIR, ni nom de personne, ni clé d'API, ni adresse.

### `GET /sources/aqoona/unlinked-people` (nouvelle)
- Accès : `@UseGuards(CapabilityGuard('sources:read'))`, `@Access({ action: 'sources:unlinked-people', roles: ['user'] })`, `@ApiRoute`. RH et superadmin ; autres rôles `403`, sans session `401`. Déclarée avant les routes à paramètre `:key/...` ; `GET` seul.
- Entrée (Zod, `z.object(evpPageShape(25))`, le schéma des anomalies réutilisé tel quel, et `evpPageOf(query, 25)`) : `from` entier 0..2147483647 (défaut 0), `size` parmi 10, 25 ou 50 (défaut 25), exactement comme `GET /sources/{key}/anomalies` (`rule-evp-access-pagination`). Hors bornes (`size` 0, 30 ou 100 ; `from` négatif ou non entier) : `400` de validation. Il n'y a ni `page` ni `pageSize`.
- Sortie : `sourceAqoonaUnlinkedPeopleSchema` (id `SourceAqoonaUnlinkedPeopleDto`) : `available`, `lastReadAt`, `windowFrom`, `windowTo`, `total` (entier ≥ 0, toutes pages), `items` (au plus `size`) `{ name: 1..200, cause: enum de cinq valeurs, causeLabel: 1..100, creches: string[] (0..50, chacun 1..200) }`.
- Libellés, une constante unique `UNLINKED_CAUSE_LABELS` partagée avec le détail des anomalies :

| `cause` | `causeLabel` |
|---|---|
| `NIR_ABSENT` | NIR absent dans Aqoona |
| `NIR_KEY_INVALID` | Clé du NIR incorrecte dans Aqoona |
| `NIR_UNKNOWN` | NIR inconnu de PayFit |
| `NIR_AMBIGUOUS` | NIR porté par plusieurs collaboratrices PayFit |
| `PAYFIT_INCOMPLETE` | NIR non vérifié : lecture PayFit incomplète |

- Calcul : mêmes conditions de disponibilité que les taux. Une entrée par (« prénom nom » normalisé, cause). `name` = « Prénom NOM » lu dans Aqoona (libellé de la première ligne retenue), « Personne non nommée » si les lignes n'ont pas de nom. `creches` = crèches des créneaux de l'entrée : nom du référentiel, sinon `creche_label`, triées par nom, dédoublonnées, tronquées à 50. Tri `name` (collation française) puis `cause` ; pagination en code après tri (`slice(from, from + size)`), `total` compté avant.
- Ne contient jamais de NIR, de fragment, d'indication sur les chiffres, de clé attendue ni d'identifiant PayFit. Aucune trace d'audit.

### `GET /sources/{key}/anomalies` (forme inchangée)
Types et textes comme dans le tableau « Anomalies » de la demande amont ; `type`, `label`, `subject`, `detail` gardent leurs bornes. Tous les textes passent par `maskNirs()` ; la clé d'API et l'adresse n'y figurent jamais.
- `payfit` : `payfit_scope_missing` (nouveau), `payfit_introspection_failed` (nouveau). Sujet « <Nom> (SIRET <14 chiffres>) » (`companyLabel()`, fonction pure partagée), « Société sans nom connu (SIRET …) » si `payfit_companies` ne la connaît pas.
- `aqoona` : `aqoona_nir_unavailable` (sujet nommé, détails sans repli sur les noms), `PLANNING_UNMATCHED` (détail « <libellé de la cause> (crèche lue : <crèche>). »), `aqoona_nir_key_invalid` (détail sans repli sur les noms), `aqoona_no_identity` (nouveau), `payfit_nir_key_invalid` (pour toutes les sociétés lues du réseau).
- Le motif « Crèche introuvable ou ambiguë » disparaît des détails (D-0022 : plus d'anomalie « Établissement Aqoona inconnu » ni « Planning non rattaché » pour un établissement inconnu).

### Autres routes
`GET /sources`, `POST /sources/{key}/refresh`, `POST /sources/refresh-all`, `GET /sources/runs/{id}` : inchangées en forme. Volumes d'Aqoona : « Plannings lus », « Plannings rattachés », « Rapprochés par NIR » ; les deux derniers sont égaux. Les lectures ne sont `PARTIAL` ni `FAILED` à cause d'une portée manquante, d'une introspection en échec, d'une clé fausse ou d'une ligne sans identité.

### Changements internes (pas de route)
1. **Table des NIR du réseau** (`readNirs()`, `PayfitNirs`) : le résultat par SIRET reste `ok` (`table`, `invalid`), `scope-missing` ou `unavailable` ; la table fusionnée du réseau associe un NIR de 15 caractères (et les 13 premiers caractères d'un NIR PayFit de 13) à l'ensemble des `(companyId, employeeId)` qui le portent. Elle vit en mémoire pendant `applyAqoona()` seulement et est remise à zéro ensuite (`nirs = new Map()`).
2. **Sociétés interrogées** : `applyAqoona()` demande les NIR de toutes les clés de `PAYFIT_API_KEYS`, dès qu'une ligne de la fenêtre a un NIR de clé juste, et non plus des seules sociétés des crèches concernées. Le réseau est connu des connecteurs, pas de l'appelant : `listPayfitNirs(sirets)` (classe abstraite `SourceConnectors`, pilotes `fake` et `real`, `PayfitClient.readNirs`) devient `listPayfitNirs()` sans argument et renvoie un résultat par SIRET du réseau (clés de `PAYFIT_API_KEYS` pour `real`, sociétés de `payfit.json` pour `fake`). Un réseau vide (aucune clé configurée, `payfit.json` illisible) ou un appel qui lève est un réseau illisible : toute ligne de NIR de clé juste est `PAYFIT_INCOMPLETE`, et `aqoona_nir_unavailable` n'est produite que pour les sociétés connues de `payfit_companies`.
3. **Algorithme par ligne** (ordre de `rule-evp-link-causes`) : ni nom ni NIR → `aqoona_no_identity`, `AUCUN`, cause nulle. NIR de forme absente ou illisible → `NIR_ABSENT`. Clé fausse → `NIR_KEY_INVALID`. Sinon recherche dans la table du réseau : plusieurs collaboratrices → `NIR_AMBIGUOUS` ; une seule → rattachée (`employee_company_id`, `employee_id`, `NIR`) ; aucune → `PAYFIT_INCOMPLETE` si au moins une société du réseau est `scope-missing` ou `unavailable` (D-0021), sinon `NIR_UNKNOWN`. Le décompte « plusieurs / une seule » porte sur les porteuses de la table en direct, que `payfit_employees` les connaisse ou non. Une seule porteuse dont le couple `(companyId, employeeId)` est absent de `payfit_employees` ne rattache pas : `PAYFIT_INCOMPLETE` (D-0024). Le rattachement se décide ligne par ligne : une ligne sans NIR d'une personne par ailleurs rattachée reste `NIR_ABSENT`, la personne est comptée rattachée et non reliée (D-0023). Une ligne sans NIR mais avec un nom reçoit `NIR_ABSENT`, sans aucun repli sur le nom.
4. **Crèche** : le rattachement ne dépend plus de la crèche. `crecheCode` et `companyId` restent ceux de l'établissement quand il est unique dans le référentiel ; sinon nuls, `creche_label` renseigné pour un créneau non rattaché.
5. **PayFit, portée à chaque lecture** : dans `PayfitClient.read()` / `context()`, une seule introspection par clé et par lecture, dont le corps sert à la fois à l'identifiant de société (si le cache n'en a pas) et à la portée ; la portée n'est jamais servie du cache d'identifiants. Seuls `scope`, `active` et `company_id` sont lus, aucun NIR. Le résultat par clé (`ok`, `scope-missing`, `failed` avec la cause en mots) est porté par un champ nouveau `PayfitData.scopeChecks` (`{ siret, status, cause? }[]`), rempli par les deux pilotes (`real` : y compris pour une société dont la lecture échoue après l'introspection ; `fake` : `nirScopeMissing` et `introspectionFailed` de `payfit.json`). `applyPayfit()` produit `payfit_scope_missing` et `payfit_introspection_failed` (une par société et par lecture) à partir de `scopeChecks`, **hors** du bloc `if (real)` existant : les tests tournent sur le pilote `fake`, qui n'a pas de `companyResults`. Le nom vient de `data.companies`, sinon de `payfit_companies`, sinon « Société sans nom connu ». Un échec d'introspection n'interrompt pas la lecture des autres sociétés.
6. **Créneaux à SIRET partagé** (`creches.service.ts`) : dans les deux sous-requêtes (`not exists` et `exists`), `p.company_id = <société>` est conservé (le créneau est lu dans une crèche de la société : c'est ce qui fait « autre crèche du SIRET ») et `p.employee_company_id = <société>` est ajouté (l'identifiant est celui d'une salariée de cette société). Remplacer `company_id` par `employee_company_id` ferait exclure à tort une volante lue dans une crèche d'un autre SIRET.
7. **Fixtures `fake`** : `payfit.json` garde `nirScopeMissing` et `nirUnavailable` et accepte `introspectionFailed` (liste de SIRET) pour la lecture PayFit ; NIR fictifs de clé juste, aucun vrai NIR.
8. **Pilote `real`** : format de `scope` toujours supposé ; à confirmer au premier essai réel.

## Règles
### Rattachement par le NIR seul
- `rule-evp-link-nir-only` (user) : `applyAqoona()` ne rattache que par le NIR, aucun repli sur `nameKey`.
- `rule-evp-link-network-wide` (user) : recherche dans la table du réseau, toutes sociétés.
- `rule-evp-link-one-establishment` (user) : `employee_company_id` distinct de `company_id` pour une volante.
- `rule-evp-link-nir-two-companies` (inferred, decision D-0020) : plus d'une collaboratrice pour un NIR de clé juste, même société ou non → `NIR_AMBIGUOUS`.
- `rule-evp-link-unusable-nir` (user) : anomalie « Planning non rattaché » avec la cause, sans NIR.
- `rule-evp-link-causes` (inferred) : ordre absent ou illisible, clé fausse, ambigu, lecture incomplète, inconnu.
- `rule-evp-link-incomplete-read` (inferred, decision D-0021) : `PAYFIT_INCOMPLETE`.
- `rule-evp-link-no-identity` (user) : `aqoona_no_identity`, créneau conservé non rattaché, hors liste et hors taux.
- `rule-evp-link-unknown-creche` (inferred, decision D-0022) : rattachée, crèche nulle, aucune anomalie d'établissement.
- `rule-evp-link-network-read` (inferred) : lecture en mémoire du réseau entier ; `rule-evp-aqoona-nir-transient-key` inchangée.
- `rule-evp-link-person-both-states` (inferred, backend, decision D-0023) : le rattachement est décidé ligne par ligne ; une personne peut être comptée rattachée et non reliée.
- `rule-evp-link-employee-not-read` (inferred, backend, decision D-0024) : un NIR trouvé en direct chez PayFit pour une collaboratrice absente de `payfit_employees` ne rattache pas ; cause `PAYFIT_INCOMPLETE`.
- `rule-evp-nir-key-invalid-unused` (user, étendue) : clé fausse inutilisée des deux côtés ; collaboratrice PayFit retirée de la table.
- `rule-evp-matching-method-first-row` (inferred, backend), `rule-evp-aqoona-nir-never-stored` (user) : voir « Données ».
- Remplacées (ne plus appliquer) : `rule-evp-aqoona-nir-fallback-name`, `rule-evp-aqoona-nir-over-name`, `rule-evp-aqoona-nir-scope-company`, `rule-evp-aqoona-nir-ambiguous`, `rule-evp-aqoona-nir-lazy`, `rule-evp-employee-multi-company` (pour le NIR).

### Taux en personnes et liste
- `rule-evp-matching-rates-people` (user), `rule-evp-matching-rates-company-of-person` (inferred), `rule-evp-matching-rates-consistency` (inferred), `rule-evp-matching-rates-unknown-mode` (D-0016, étendue), `rule-evp-matching-rates-percent`, `-no-company` (D-0015), `-route`, `-same-rights`, `-live`, `-no-nir`.
- `rule-evp-unlinked-list` (user), `rule-evp-unlinked-list-same-rights` (user), `rule-evp-unlinked-list-no-nir` (user), `rule-evp-unlinked-list-grain` (inferred), `rule-evp-unlinked-list-paging` (inferred).
- Remplacées : `rule-evp-matching-rates-slots`, `rule-evp-matching-rates-three-parts`.

### Portée PayFit à chaque lecture, société nommée
- `rule-evp-payfit-scope-every-read` (user), `rule-evp-payfit-scope-introspection-failed` (user), `rule-evp-payfit-scope-no-nir-read` (user, D-0018), `rule-evp-company-named-in-anomalies` (user).
- `rule-evp-payfit-scope-read-only`, `-format`, `-no-failure`, `-one-per-key` (inferred).
- Remplacée : `rule-evp-payfit-scope-coverage` (D-0019).
- Inchangées : `rule-evp-aqoona-nir-format`, `rule-evp-nir-key-formula`, `-vectors`, `-both-sides`, `-never-shown`, `rule-evp-aqoona-nir-unavailable` (étendue), `rule-evp-sources-partial-failure`, `rule-evp-sources-guard`, `rule-evp-secrets-never-exposed`.

## Tests
Jest dans `api/src/features/sources/tests/` (et `creches/tests/` pour le SIRET partagé), API de test, pilote `fake`, tables vidées en `beforeEach`. Chaque test cite sa règle. La suite d'acceptation est à QA, qui réécrit aussi les tests de v1 à v4 reposant sur le prénom et le nom.

- `aqoona-readers.test.ts`, `nir-key-readers.test.ts` réécrits : rattachement par NIR sans repli sur le nom (même nom, NIR absent → non rattachée) ; volante rattachée à sa société de référence alors que `company_id` est celui de la crèche ; NIR d'une société autre que celle de la crèche ; NIR PayFit de 13 caractères ; chaque cause (`NIR_ABSENT` y compris valeur mal formée, `NIR_KEY_INVALID`, `NIR_UNKNOWN`, `NIR_AMBIGUOUS` même société et deux sociétés, `PAYFIT_INCOMPLETE` société sans portée et société illisible) ; ligne sans nom ni NIR (`aqoona_no_identity`, hors liste et taux, lecture `SUCCESS`) ; ligne à NIR sans nom (« Personne non nommée ») ; établissement inconnu rattaché par NIR (Q-EVP-21) ; personne rattachée et non reliée (Q-EVP-22) ; NIR trouvé pour une collaboratrice non lue (Q-EVP-23) ; collaboratrice PayFit de clé fausse non trouvable et sans effet sur le NIR valide d'une autre.
- Volumes de `GET /sources` : « Plannings rattachés » égal à « Rapprochés par NIR ».
- `matching-rates.test.ts` réécrit : forme `linked`/`unlinked`, personnes distinctes (même personne dans deux crèches et plusieurs créneaux comptée une fois), pourcentages à une décimale, personne non reliée de deux sociétés comptée dans chacune, ligne « Sans société identifiée », tri français, `available: false` (jamais lue, créneau `NOM` ou `INCONNU` posé en SQL), `available: true` avec `items: []`, droits (RH et superadmin `200` ; directrice, RO, administratrice `403` ; sans session `401`), cohérence avec les volumes et la liste, aucun NIR ni nom.
- `GET /sources/aqoona/unlinked-people` : nominal (nom, cause, libellé, crèches triées), grain par personne et par cause, « Personne non nommée », crèche inconnue (établissement lu), pagination (`from` et `size` : défaut 25, `size` 10 et 50, `from` au-delà du total → `items` vide et `total` exact ; `size` 0, 30, 100 et `from` -1 → `400`), tri, `available: false`, droits, aucun NIR ni fragment.
- Anomalies de PayFit : portée manquante pour une clé (sujet nommé, détail), introspection en échec (réseau, `401`, `403`, `429`, `5xx`, clé inactive, réponse inattendue : aucune portée devinée), une anomalie par société et par lecture, société sans nom connu, lecture `SUCCESS`, aucune lecture de NIR, l'introspection reste le seul `POST`, enchaînement par `refresh-all`, identifiant en cache mais portée relue.
- Anomalies d'Aqoona : `aqoona_nir_unavailable` nommée (nom et SIRET), détails sans repli sur les noms ; `PLANNING_UNMATCHED` avec la cause ; `payfit_nir_key_invalid` pour toutes les sociétés lues ; aucune valeur de NIR dans réponses, anomalies, journal d'audit, journal du serveur ni corps d'erreur.
- `creches` : SIRET partagé, un identifiant de collaboratrice d'une autre société (volante) n'est jamais pris pour celui d'une salariée de la société.
- Contrat : l'OpenAPI contient la nouvelle opération et la forme modifiée aux bornes de la demande ; `cuisine:routes` déclare `auth`, actions `sources:matching-rates` et `sources:unlinked-people`.
- Migration : sur des lignes d'avant la v5 posées en SQL avant la migration, `employee_company_id` = `company_id` pour les rattachées, `AUCUN` devenu `INCONNU` (routes `available: false`, jamais des taux faux), `check` des causes et `check` de cohérence `employee_id` / `employee_company_id`.
- Réseau illisible (aucune clé configurée, appel en échec) : ligne de NIR de clé juste `PAYFIT_INCOMPLETE`, lecture `SUCCESS`. Deux porteuses du NIR dont une absente de `payfit_employees` : `NIR_AMBIGUOUS`. Une seule introspection `POST` par clé et par lecture de PayFit, identifiant en cache ou non.
- `creches` : volante d'une société lue dans une crèche d'un autre SIRET, non exclue des contrats proposés par la crèche à SIRET partagé de sa société.
- Litige à ouvrir en fabrication : `OPEN: contract GET /sources/aqoona/matching-rates : forme en personnes (linked, unlinked) au lieu de créneaux (byNir, byName, unmatched), demandé par la v5` (`DISPUTES.md` de ce dossier).
