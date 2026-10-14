# Demande à l'API : rattachement par le NIR seul, taux en personnes, liste des personnes non reliées, portée PayFit à chaque lecture

Écran demandeur : Sources (`/sources`). Besoin : que le rattachement d'une ligne Aqoona à une collaboratrice PayFit se fasse par le NIR seul, dans tout le réseau, sans jamais retomber sur le prénom et le nom ; que l'écran lise, par société, le nombre de personnes rattachées et non reliées, puis la liste nominative des personnes non reliées avec leur cause ; que chaque lecture de PayFit signale les clés sans la portée « numéro de sécurité sociale » ; que les sociétés soient nommées dans ces anomalies.

Les demandes de la v1 à la v4 (`../v4-evp-fiabilite-nir/sources-api-modification-request.md` en particulier) restent la référence pour tout ce qui n'est pas dit ici. Choix tranchés : `questions.yaml` (Q-EVP-19 à Q-EVP-23), inscrits au registre : D-0020 (A), D-0021 (B), D-0022 (A), D-0023 (A), D-0024 (A), appliqués ci-dessous.

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /sources/aqoona/matching-rates` (**forme modifiée**) | `sources:matching-rates` (inchangé) | capacité `sources:read` (RH, superadmin), inchangé | aucune | `200` : voir « Réponse des taux » ; `401`, `403` comme `GET /sources` (corps `{ status, code, message }`) |
| `GET /sources/aqoona/unlinked-people` (**nouvelle**) | `sources:unlinked-people` | capacité `sources:read` (RH, superadmin ; mêmes droits que l'écran Sources) | `from` entier 0..2147483647 (défaut 0), `size` parmi 10, 25, 50 (défaut 25) : les paramètres, bornes et défauts de `GET /sources/{key}/anomalies` (`evpPageShape(25)`) | `200` : voir « Réponse de la liste » ; `400` paramètre hors bornes ; `401`, `403` comme `GET /sources`. `GET` seul |
| `GET /sources/{key}/anomalies` | `sources:anomalies` (inchangé) | inchangé | inchangée | forme inchangée ; types ajoutés pour `payfit` et `aqoona`, détails et sujets précisés (tableau « Anomalies »). Ni `subject` ni `detail` ne contient jamais de NIR, de clé de NIR, de fragment ni d'indication sur les chiffres |
| `GET /sources`, `POST /sources/{key}/refresh`, `POST /sources/refresh-all`, `GET /sources/runs/{id}` | inchangées | inchangés | inchangée | inchangées (volumes d'Aqoona : « Plannings lus », « Plannings rattachés », « Rapprochés par NIR » ; les deux derniers sont désormais égaux, puisqu'une ligne n'est rattachée que par le NIR) |

Le chemin `/sources/aqoona/unlinked-people` ne rentre pas en conflit avec `/sources/:key/anomalies` ni `/sources/:key/refresh` (dernier segment et méthode différents) ; il est déclaré avant les routes à paramètre si l'ordre compte pour le routeur.

### Réponse des taux de `GET /sources/aqoona/matching-rates` (Zod, `id` `SourceAqoonaMatchingRatesDto`, remplace la forme de la v4)
```
{
  available:   boolean,
  lastReadAt:  date-time | null,
  windowFrom:  date AAAA-MM-JJ | null,
  windowTo:    date AAAA-MM-JJ | null,
  items: [                           // au plus 200
    {
      companyId: string 1..100 | null,   // null : ligne « Sans société identifiée »
      siret:     string 1..20 | null,
      name:      string 1..200,
      total:     int >= 1,               // personnes distinctes de la ligne
      linked:    { count: int >= 0, percent: number 0..100 },   // rattachées par leur NIR
      unlinked:  { count: int >= 0, percent: number 0..100 }    // non reliées
    }
  ]
}
```
- `available` vaut `false`, `items` vide, quand Aqoona n'a jamais été lue avec succès, ou quand au moins un créneau stocké est écrit d'avant la v5 (mode `NOM` ou `INCONNU`, cause inconnue) ; il vaut `true` sinon, `items` pouvant être vide (aucune personne) (`rule-evp-matching-rates-unknown-mode`, D-0016, étendue).
- `total` = `linked.count + unlinked.count`. `percent` = `round(100 × count / total, 1)`.
- Une ligne par société qui a au moins une personne, triée par `name` croissant (comparaison française, sans casse ni accents), puis `companyId` ; la ligne `companyId` nul en dernier (`name: "Sans société identifiée"`, D-0015).
- Aucun NIR, aucun nom de personne, aucune clé d'API, aucune adresse.

### Réponse de la liste de `GET /sources/aqoona/unlinked-people` (Zod, `id` `SourceAqoonaUnlinkedPeopleDto`)
```
{
  available:  boolean,                 // mêmes conditions que pour les taux
  lastReadAt: date-time | null,
  windowFrom: date AAAA-MM-JJ | null,
  windowTo:   date AAAA-MM-JJ | null,
  total:      int >= 0,                // entrées de la liste (toutes pages)
  items: [                             // au plus size (10, 25 ou 50)
    {
      name:       string 1..200,       // « Prénom NOM » lu dans Aqoona ; « Personne non nommée » si la ligne n'a pas de nom
      cause:      enum NIR_ABSENT | NIR_KEY_INVALID | NIR_UNKNOWN | NIR_AMBIGUOUS | PAYFIT_INCOMPLETE,
      causeLabel: string 1..100,       // libellé français de l'API
      creches:    string[] (0..50 éléments, chacun 1..200)   // crèches où la personne a été lue ; nom du référentiel, ou établissement tel que lu dans Aqoona s'il est inconnu du référentiel
    }
  ]
}
```
- Causes et libellés (`rule-evp-link-causes`) :

| `cause` | `causeLabel` | Quand |
|---|---|---|
| `NIR_ABSENT` | NIR absent dans Aqoona | la ligne n'a pas de NIR, ou une valeur qui n'a pas la forme d'un NIR de 15 caractères |
| `NIR_KEY_INVALID` | Clé du NIR incorrecte dans Aqoona | la ligne a un NIR dont la clé de contrôle est fausse |
| `NIR_UNKNOWN` | NIR inconnu de PayFit | NIR de clé juste qu'aucune collaboratrice du réseau ne porte, toutes les sociétés étant lues |
| `NIR_AMBIGUOUS` | NIR porté par plusieurs collaboratrices PayFit | NIR de clé juste porté par plusieurs collaboratrices, de la même société ou de deux sociétés (D-0020) |
| `PAYFIT_INCOMPLETE` | NIR non vérifié : lecture PayFit incomplète | NIR de clé juste introuvable alors qu'au moins une société est illisible ou sans la portée (D-0021) ; vaut aussi pour un NIR trouvé en direct chez PayFit pour une collaboratrice absente de `payfit_employees` (D-0024) |

- Grain : une entrée par personne distincte et par cause (la personne se reconnaît à « prénom nom » normalisé, `normalise()`, sans casse ni accents, parce qu'une ligne non reliée n'a pas d'autre identité) ; `creches` rassemble ses crèches, triées par nom. Tri : `name` (collation française), puis `cause`. `total` compte ces entrées.
- Les personnes dont aucune ligne n'a de nom (ligne avec NIR, sans nom) sont regroupées sous « Personne non nommée », une entrée par cause.
- Une ligne sans nom ni NIR n'est pas une personne : elle n'est ni dans la liste ni dans les taux, elle produit seulement l'anomalie `aqoona_no_identity` (`rule-evp-link-no-identity`).
- Aucun NIR, aucun fragment, aucune indication sur les chiffres, aucune clé attendue, aucun identifiant PayFit (`rule-evp-unlinked-list-no-nir`, user).

## Stockage
- `base.aqoona_plannings` (table de la fonctionnalité `sources`, hors `data-contract.md`) : colonnes ajoutées par `pnpm migrate:gen` puis `pnpm migrate:all` :
  - `employee_company_id` texte nullable : société PayFit de référence de la collaboratrice rattachée (pas nécessairement celle de la crèche, cas d'une volante) ;
  - `unlinked_cause` texte nullable, contrainte `check` sur les cinq causes ; renseignée si et seulement si `employee_id` est nul et que la ligne a un nom ou un NIR ;
  - `creche_label` texte nullable : établissement tel que lu dans Aqoona, conservé pour les créneaux non reliés dont la crèche est inconnue du référentiel (nom d'établissement, jamais un NIR) ; la fabrication peut à la place étendre `aqoona_mismatches`, le résultat de la liste est le même.
- `match_method` : `NIR` (rattaché), `AUCUN` (non rattaché), `INCONNU` (d'avant la v4) ; `NOM` n'est plus écrit et reste dans la contrainte pour les lignes d'avant la v5, qui rendent les taux indisponibles tant qu'une lecture complète d'Aqoona ne les a pas remplacées. Les lignes `AUCUN` d'avant la v5 n'ont pas de cause : la migration les passe à `INCONNU` (sinon elles se confondraient avec les lignes sans nom ni NIR). La migration renseigne aussi `employee_company_id` = `company_id` pour les lignes déjà rattachées.
- `company_id` du créneau reste la société de la crèche (SIRET de la crèche, comme en v3), inchangée : elle sert aux crèches à SIRET partagé (`creches.service.ts`). `employee_id` désigne une collaboratrice de la société `employee_company_id`, qui peut être différente de `company_id` pour une volante. Aucune colonne ne porte de NIR, d'empreinte ni de fragment (`rule-evp-aqoona-nir-never-stored`, user). La clé d'unicité `aqoona_plannings_slot_unique` ne change pas.

## Règles
### Rattachement par le NIR seul
- `rule-evp-link-nir-only` (user) : une ligne Aqoona n'est rattachée à une collaboratrice PayFit que par son NIR ; jamais par le prénom et le nom. Un écart entre les deux sources est une anomalie à corriger, pas un cas à rattraper. Remplace l'appariement par prénom et nom de la v1 et son repli de la v3 (`rule-evp-aqoona-nir-fallback-name`) ; remplace `rule-evp-aqoona-nir-over-name`, `rule-evp-nir-key-invalid-unused` (volet repli sur les noms) et `rule-evp-sources-no-invention` pour ce flux : sans NIR exploitable, aucune collaboratrice n'est devinée.
- `rule-evp-link-network-wide` (user) : la collaboratrice est cherchée par son NIR parmi toutes les collaboratrices du réseau, quelle que soit sa société PayFit, et non plus dans la seule société de la crèche du créneau. Remplace `rule-evp-aqoona-nir-scope-company`. Le rattachement ne dépend pas de la crèche du créneau.
- `rule-evp-link-one-establishment` (user) : une salariée n'appartient qu'à un établissement PayFit ; une volante, qui travaille aussi dans d'autres crèches y compris d'autres sociétés, compte sur sa société PayFit de référence (`employee_company_id`). Le créneau garde la société et la crèche où il a été lu (`company_id`, `creche_code`).
- `rule-evp-link-nir-two-companies` (inferred, decision D-0020) : un NIR de clé juste porté par plusieurs collaboratrices, de la même société ou de deux sociétés, est ambigu : aucune n'est rattachée, la cause est `NIR_AMBIGUOUS`. Remplace `rule-evp-aqoona-nir-ambiguous` (D-0014) en l'étendant au réseau, et `rule-evp-employee-multi-company` pour le rattachement par NIR (deux collaboratrices distinctes de deux sociétés ne sont toujours jamais fusionnées par le nom).
- `rule-evp-link-unusable-nir` (user) : une ligne sans NIR exploitable (NIR absent, clé fausse, NIR inconnu de PayFit) n'est pas rattachée et produit une anomalie « Planning non rattaché » dont le détail donne la cause, sans jamais afficher de NIR. Un NIR est exploitable s'il a la forme de 15 caractères (séparateurs retirés, `2A`/`2B` admis, `rule-evp-aqoona-nir-format`) et une clé juste (`rule-evp-nir-key-formula`).
- `rule-evp-link-causes` (inferred) : les cinq causes du tableau ci-dessus ; une seule cause par ligne, dans l'ordre : forme absente ou illisible, clé fausse, ambigu, lecture incomplète, inconnu.
- `rule-evp-link-incomplete-read` (inferred, decision D-0021) : un NIR de clé juste introuvable alors qu'au moins une société du réseau n'a pas pu être lue (clé absente, introspection en échec, portée manquante) a la cause `PAYFIT_INCOMPLETE`, pas `NIR_UNKNOWN` : on ne devine pas que le NIR est inconnu.
- `rule-evp-link-no-identity` (user) : une ligne Aqoona sans nom ni NIR est une anomalie : type `aqoona_no_identity`, libellé « Ligne Aqoona sans nom ni NIR », `subject` = libellé de l'adresse Aqoona (comme « Créneau Aqoona sans type »), `detail` « N ligne(s) sans nom ni NIR. ». Le créneau est conservé non rattaché (`match_method` `AUCUN`, `unlinked_cause` nul). Ne rend la lecture ni `PARTIAL` ni `FAILED`.
- `rule-evp-link-unknown-creche` (inferred, decision D-0022) : une ligne dont le NIR désigne une collaboratrice est rattachée même si son établissement est inconnu du référentiel ; le créneau garde `creche_code` nul et aucune anomalie ne concerne l'établissement. Elle n'est plus « Planning non rattaché » pour ce motif.
- `rule-evp-link-person-both-states` (inferred, backend, decision D-0023) : le rattachement se fait ligne par ligne par le NIR seul. Une personne dont un créneau porte un NIR de clé juste connu de PayFit et dont un autre créneau n'a pas de NIR est comptée rattachée et non reliée ; la liste la signale avec la cause `NIR_ABSENT` et la crèche du créneau sans NIR. Aucune reconnaissance par le nom n'écarte ce créneau de la liste.
- `rule-evp-link-employee-not-read` (inferred, backend, decision D-0024) : un NIR trouvé en direct chez PayFit pour une collaboratrice absente de `payfit_employees` (lecture complète de PayFit pas encore faite, ou antérieure à son arrivée) ne rattache pas ; la cause est `PAYFIT_INCOMPLETE`, et la personne est rattachée à la lecture d'Aqoona qui suit une lecture de PayFit. Aucun identifiant de collaboratrice sans fiche n'est créé.
- `rule-evp-link-network-read` (inferred) : les NIR de PayFit sont lus, en mémoire seulement, pour toutes les sociétés du réseau (une par clé de `PAYFIT_API_KEYS`), pendant la lecture d'Aqoona, et seulement si au moins une ligne de la fenêtre a un NIR de clé juste. Ils ne sont jamais conservés (`rule-evp-aqoona-nir-transient-key`, user, inchangée). Remplace `rule-evp-aqoona-nir-lazy` (lecture des seules sociétés des crèches concernées). Une société dont la lecture échoue ne fait pas échouer la lecture d'Aqoona (`rule-evp-aqoona-nir-unavailable`, inchangée, étendue) ; sa collaboratrice n'est alors pas trouvable, d'où `PAYFIT_INCOMPLETE`.
- `rule-evp-nir-key-invalid-unused` (user, étendue) : un NIR de clé fausse ne sert pas au rattachement, côté Aqoona (la ligne est non rattachée, cause `NIR_KEY_INVALID`) comme côté PayFit (la collaboratrice est retirée de la table des NIR : elle n'est trouvable par personne, elle ne rend pas ambigu le NIR valide d'une autre).

### Taux en personnes et liste
- `rule-evp-matching-rates-people` (user) : le taux de rattachement d'Aqoona se compte en personnes, pas en créneaux ; remplace `rule-evp-matching-rates-slots`, `rule-evp-matching-rates-three-parts`, `rule-evp-matching-rates-consistency` (en créneaux). Une personne rattachée est une salariée distincte `(employee_company_id, employee_id)`, comptée une fois quel que soit le nombre de ses créneaux ou de ses crèches. Une personne non reliée est une personne distincte, reconnue à son « prénom nom » normalisé, ayant au moins un créneau non rattaché avec une cause.
- `rule-evp-matching-rates-company-of-person` (inferred) : une personne rattachée compte pour sa société de référence (`employee_company_id`) ; une personne non reliée compte pour la société de chaque crèche où elle a été lue (`company_id` du créneau), et pour la ligne « Sans société identifiée » quand cette société est inconnue (crèche inconnue, SIRET sans société unique). Une personne non reliée lue dans les crèches de deux sociétés compte dans les deux lignes ; il n'y a pas de total général, donc pas de double compte visible.
- `rule-evp-matching-rates-consistency` (inferred, remplace celle de la v4) : la somme des `linked.count` = nombre de salariées distinctes rattachées ; tout créneau « rattaché » de « Plannings rattachés » et de « Rapprochés par NIR » est dans une personne rattachée ; toute personne comptée non reliée figure dans la liste. Vaut après une lecture sans adresse en échec (`rule-evp-sources-partial-failure`).
- `rule-evp-matching-rates-percent`, `-no-company` (D-0015), `-route`, `-same-rights`, `-live`, `-unknown-mode` (D-0016, étendue ci-dessus), `-no-nir` (user) : inchangées, sauf `-no-nir` qui vaut aussi pour la liste.
- `rule-evp-unlinked-list` (user) : la liste nomme chaque personne non reliée entre Aqoona et PayFit, avec la cause et la crèche, pour corriger la donnée à la source.
- `rule-evp-unlinked-list-same-rights` (user) : mêmes droits que l'écran Sources (RH et superadmin) ; `403` pour les autres rôles, `401` sans session.
- `rule-evp-unlinked-list-no-nir` (user) : la liste nomme la personne, jamais un NIR.
- `rule-evp-unlinked-list-grain` (inferred) : voir « Réponse de la liste » (une entrée par personne et par cause).
- `rule-evp-unlinked-list-paging` (inferred) : pagination par `from` et `size` comme les anomalies ; hors bornes, `400` de validation.

### Portée PayFit à chaque lecture, société nommée
- `rule-evp-payfit-scope-every-read` (user) : chaque lecture de PayFit (manuelle, ou enchaînée par « Actualiser toutes les sources ») fait une introspection de chaque clé de `PAYFIT_API_KEYS`, y compris quand l'identifiant de société est en cache (`rule-evp-payfit-company-id` : l'identifiant reste mis en cache, la portée jamais), et signale dans les anomalies de PayFit toute clé sans `collaborators:social-security:read` pour la société concernée. Remplace `rule-evp-payfit-scope-coverage` (D-0019, limité aux sociétés interrogées par la lecture d'Aqoona).
- `rule-evp-payfit-scope-introspection-failed` (user) : une introspection qui échoue (réseau, `401`, `403`, `429`, `5xx`, clé inactive, réponse inattendue) est signalée elle aussi dans les anomalies de PayFit, sans rien deviner de la portée : ni « portée présente » ni « portée manquante ».
- `rule-evp-payfit-scope-no-nir-read` (user, `rule-evp-aqoona-nir-transient-key`, D-0018) : la lecture PayFit ne lit toujours aucun NIR ; l'introspection ne lit que `scope` et `active`.
- `rule-evp-payfit-scope-read-only`, `-format` (inferred, inchangées) : l'introspection est le seul `POST` ; `scope` est une chaîne à espaces ou un tableau ; comparaison exacte ; `scope` absent ou vide = portée manquante quand l'introspection répond `active: true`.
- `rule-evp-payfit-scope-no-failure` (inferred) : ces anomalies ne rendent la lecture de PayFit ni `PARTIAL` ni `FAILED` à elles seules ; si l'introspection en échec est aussi ce qui rend la société inaccessible pour la lecture, « Société inaccessible » et l'anomalie d'introspection coexistent (une anomalie par signalement).
- `rule-evp-payfit-scope-one-per-key` (inferred) : au plus une anomalie de portée par société et par lecture de PayFit.
- `rule-evp-company-named-in-anomalies` (user) : les anomalies de portée désignent la société par son nom et son SIRET : « <Nom de la société> (SIRET <14 chiffres>) ». Le nom est celui de `payfit_companies` ; si la société n'a jamais été lue, « Société sans nom connu (SIRET <14 chiffres>) ». Vaut pour « Rapprochement par NIR indisponible » et pour les deux types nouveaux de PayFit.

## Anomalies
| Source | Type | Libellé (`label`) | `subject` | `detail` |
|---|---|---|---|---|
| `payfit` | `payfit_scope_missing` (nouveau) | Portée PayFit manquante | « <Nom> (SIRET <14 chiffres>) » | « La portée « collaborators:social-security:read » manque à la clé de cette société : ses salariées ne peuvent pas être rattachées par leur NIR. » |
| `payfit` | `payfit_introspection_failed` (nouveau) | Introspection de la clé PayFit en échec | « <Nom> (SIRET <14 chiffres>) » | « La portée de la clé n'a pas pu être vérifiée : <cause en mots : PayFit injoignable, clé refusée, limite de débit, clé inactive, réponse inattendue>. » (jamais la clé ni l'adresse) |
| `aqoona` | `aqoona_nir_unavailable` (modifié) | Rapprochement par NIR indisponible | « <Nom> (SIRET <14 chiffres>) » (était : le SIRET seul) | portée manquante : « La portée « collaborators:social-security:read » manque à la clé PayFit. Les collaboratrices de cette société ne peuvent pas être trouvées par leur NIR. » ; autre cause : « Les collaboratrices de cette société ne peuvent pas être trouvées par leur NIR. » (les noms ne sont plus utilisés à la place) |
| `aqoona` | `PLANNING_UNMATCHED` « Planning non rattaché » (détail modifié) | Planning non rattaché | « Prénom NOM » (ou « Personne non nommée ») | « <libellé de la cause> (crèche lue : <crèche>). » ; plus de motif « Collaboratrice introuvable ou ambiguë dans la société de la crèche » ni « Crèche introuvable ou ambiguë » |
| `aqoona` | `aqoona_nir_key_invalid` (détail modifié) | Clé de NIR Aqoona incorrecte | « Prénom NOM » | « N créneau(x) : la clé de contrôle du NIR est incorrecte, la ligne n'est pas rattachée. » (était : « le prénom et le nom sont utilisés ») |
| `aqoona` | `aqoona_no_identity` (nouveau) | Ligne Aqoona sans nom ni NIR | libellé de l'adresse | « N ligne(s) sans nom ni NIR. » |
| `aqoona` | `payfit_nir_key_invalid` (inchangé) | Clé de NIR PayFit incorrecte | « Prénom NOM » ou « Collaboratrice <identifiant> » | inchangé (« Société <SIRET> : … ») ; pour toutes les sociétés lues du réseau |

Les anomalies de portée du côté d'Aqoona (`aqoona_nir_unavailable`) ne sont produites que si la lecture d'Aqoona lit les NIR du réseau (au moins une ligne de clé juste) ; celles de PayFit le sont à chaque lecture de PayFit. Les deux sources sont indépendantes : une clé sans la portée peut figurer dans les deux listes.

Fixtures du pilote `fake` : `payfit.json` garde `nirScopeMissing` (liste de SIRET) et `nirUnavailable`, et simule en plus, pour la lecture PayFit, l'introspection en échec (`introspectionFailed`, liste de SIRET). Les deux pilotes (`fake` et `real`) renseignent un résultat de portée par clé dans la donnée lue de PayFit : les anomalies de portée de PayFit sont produites avec le pilote `fake` comme avec le pilote `real`. Aucun vrai NIR dans le dépôt ni les fixtures.

## Compatibilité
- **Rupture de contrat** : `GET /sources/aqoona/matching-rates` change de forme (`byNir`, `byName`, `unmatched` sont remplacés par `linked`, `unlinked` ; `total` compte des personnes). La v5 est la demande du propriétaire (rattachement par NIR seul, taux en personnes, section 1 et 2) : la fabrication ouvre `OPEN: contract GET /sources/aqoona/matching-rates : forme en personnes (linked, unlinked) au lieu de créneaux (byNir, byName, unmatched), demandé par la v5` dans `DISPUTES.md`, et QA met à jour `contract-changes.yaml` et `permissions.yaml`.
- **Route ajoutée** : `GET /sources/aqoona/unlinked-people`, action `sources:unlinked-people` : additive. `specifications/permissions.yaml` (QA) doit recevoir l'entrée (capacité `sources:read`, RH et superadmin, règles `rule-evp-unlinked-list*`, `rule-evp-matching-rates-*`) ; `specifications/openapi.json` est régénéré par la porte de contrat.
- **Anomalies** : schéma inchangé ; types, sujets et détails nouveaux ou modifiés ci-dessus. Les tests de v1 à v4 qui reposent sur l'appariement par prénom et nom, ou sur le repli sur les noms (par exemple « Les noms sont utilisés à la place du NIR », le repli de D-0014, « Rattachés par prénom et nom ») sont réécrits par QA pour cette règle (c'est une demande de la v5, pas un litige de la fabrication).
- **Crèches à SIRET partagé** (`creches.service.ts`, v3, `rule-evp-siret-shared-contracts`) : comportement inchangé pour une salariée lue dans les crèches de sa propre société ; la requête en `not exists` sur `aqoona_plannings` ajoute `p.employee_company_id = <société>` à ses conditions, de sorte qu'un identifiant de collaboratrice d'une autre société (volante) ne soit jamais pris pour celui d'une salariée de la société.
- **Données d'avant la v5** : créneaux `NOM` ou `INCONNU` conservés jusqu'à une lecture complète d'Aqoona ; les deux routes disent alors `available: false`.
- Aucune variable d'environnement nouvelle. Le point 5 de la demande (test instable de la v4) est un test de QA : aucune route ni aucun comportement n'est concerné.
- Hors demande, non préparé ici : saisie des absences de volantes par la directrice de la crèche d'accueil, droits de rattachement des volantes, contrôle des heures planifiées contre les heures du contrat PayFit.
