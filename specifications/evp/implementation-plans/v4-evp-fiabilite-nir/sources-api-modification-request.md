# Demande à l'API : fiabilité du rapprochement par NIR (portée PayFit, clé de contrôle, taux de rattachement)

Écran demandeur : Sources (`/sources`). Besoin : que le rapprochement par NIR ne retombe plus en silence sur les noms quand PayFit ne livre pas le NIR (portée vérifiée par l'introspection), que les NIR à clé de contrôle fausse, côté Aqoona comme côté PayFit, ne servent jamais au rapprochement et soient signalés sans que la valeur apparaisse, et que l'écran puisse lire, pour chaque société, la part des créneaux Aqoona rattachés par NIR, par prénom et nom, ou non rattachés.

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /sources/aqoona/matching-rates` (nouvelle) | `sources:matching-rates` | capacité `sources:read` (RH, superadmin ; comme `GET /sources`) | aucune | `200` : voir « Réponse » ci-dessous. `401` et `403` comme `GET /sources` (corps `{ status, code, message }`). Aucun paramètre ; `GET` seul |
| `GET /sources/{key}/anomalies` | `sources:anomalies` (inchangé) | inchangé | inchangée | forme inchangée ; types ajoutés et détail précisé pour `aqoona` (tableau « Anomalies »). Ni `subject` ni `detail` ne contient jamais de NIR, de clé de NIR ni de fragment |
| `GET /sources`, `POST /sources/{key}/refresh`, `POST /sources/refresh-all`, `GET /sources/runs/{id}` | inchangées | inchangés | inchangée | inchangées (les volumes d'Aqoona restent « Plannings lus », « Plannings rattachés », « Rapprochés par NIR ») |

Le chemin `/sources/aqoona/matching-rates` ne rentre pas en conflit avec `/sources/:key/anomalies` ni avec `/sources/:key/refresh` (dernier segment et méthode différents) ; il est déclaré avant les routes à paramètre si l'ordre de déclaration compte pour le routeur.

### Réponse de `GET /sources/aqoona/matching-rates` (Zod, `id` `SourceAqoonaMatchingRatesDto`)
```
{
  available:   boolean,
  lastReadAt:  date-time | null,    // dernière lecture d'Aqoona réussie (celle de GET /sources)
  windowFrom:  date AAAA-MM-JJ | null,
  windowTo:    date AAAA-MM-JJ | null,
  items: [                           // au plus 200
    {
      companyId: string 1..100 | null,   // null : ligne « sans société identifiée »
      siret:     string 1..20 | null,
      name:      string 1..200,
      total:     int >= 1,
      byNir:     { count: int >= 0, percent: number 0..100 },
      byName:    { count: int >= 0, percent: number 0..100 },
      unmatched: { count: int >= 0, percent: number 0..100 }
    }
  ]
}
```
- `available` vaut `false`, avec `items` vide, quand Aqoona n'a jamais été lue avec succès (`lastReadAt` nul) ou quand au moins un créneau stocké a un mode de rattachement `INCONNU` (écrit avant la v4). Il vaut `true` sinon, `items` pouvant alors être vide (aucun créneau).
- `total` = `byNir.count + byName.count + unmatched.count`. `percent` = `round(100 × count / total, 1)`.
- Tri : `name` croissant (comparaison française, sans casse ni accents), puis `companyId` ; la ligne `companyId` nul en dernier.
- Une ligne par société PayFit qui a au moins un créneau stocké. Une dernière ligne `companyId: null`, `siret: null`, `name: "Sans société identifiée"` regroupe les créneaux sans `company_id` (décision D-0015).
- Aucun NIR, aucune clé d'API, aucune adresse, aucun nom de collaboratrice dans cette réponse.

## Stockage
- Colonne ajoutée à `base.aqoona_plannings` (table de la fonctionnalité `sources`, hors `data-contract.md`) : `match_method` texte non nul, valeurs `NIR`, `NOM`, `AUCUN`, `INCONNU`, défaut `INCONNU`, contrainte `check` ; migration par `pnpm migrate:gen` puis `pnpm migrate:all`. La lecture d'Aqoona écrit toujours `NIR`, `NOM` ou `AUCUN` ; `INCONNU` ne désigne que les lignes antérieures à la migration. La colonne ne porte aucun NIR, aucune empreinte ni aucun fragment (`rule-evp-aqoona-nir-never-stored`, user). La clé d'unicité `aqoona_plannings_slot_unique` ne change pas.
- `NIR` : le NIR d'Aqoona, de clé juste, a désigné une collaboratrice unique de la société de la crèche. `NOM` : la collaboratrice est unique par prénom et nom et le NIR n'a pas servi (absent, de clé fausse, sans correspondance, société sans NIR lisible). `AUCUN` : `employee_id` nul (y compris « Rattachement par NIR ambigu » et société non identifiée).
- Un créneau dédoublonné garde le mode de la première ligne retenue (comme il garde déjà la première ligne pour l'adresse).

## Règles
### Portée PayFit vérifiée
- `rule-evp-payfit-scope-checked` (user) : EVP lit les portées de chaque clé dans la réponse d'introspection (`POST https://oauth.payfit.com/introspect`, champ `scope`) avant de lire les NIR d'une société.
- `rule-evp-payfit-scope-format` (inferred) : `scope` est une chaîne de portées séparées par des espaces (norme d'introspection OAuth 2.0) ; un tableau de chaînes est aussi accepté. La portée requise est `collaborators:social-security:read`, comparée exactement. Un `scope` absent, vide ou sans cette portée vaut « portée manquante » (prudence : on ne devine pas). Une introspection avec `active: false`, une erreur de réseau ou un statut `401/403/429/5xx` vaut « société illisible » (cas existant).
- `rule-evp-payfit-scope-fresh` (inferred) : l'introspection pour les portées est faite à chaque lecture d'Aqoona qui lit les NIR de la société, jamais servie du cache d'identifiant de société (`rule-evp-payfit-company-id`, inchangée : l'identifiant reste mis en cache avec l'empreinte de la clé, les portées non). Une portée accordée plus tard est donc vue à la lecture suivante.
- `rule-evp-payfit-scope-missing-fallback` (user) : si la portée manque, l'anomalie `aqoona_nir_unavailable` « Rapprochement par NIR indisponible » (`subject` = SIRET de la société) est créée et le rapprochement de cette société se fait par prénom et nom. Les NIR éventuellement présents dans la réponse des collaborateurs ne sont alors pas utilisés (pas de `GET` des collaborateurs pour cette société). La lecture n'échoue pas et n'est pas `PARTIAL` pour cette raison (`rule-evp-aqoona-nir-unavailable`, inchangée dans le reste).
- `rule-evp-payfit-scope-detail` (inferred) : le `detail` de cette anomalie vaut « La portée « collaborators:social-security:read » manque à la clé PayFit. Les noms sont utilisés à la place du NIR. » quand la cause est la portée ; il garde « Les noms sont utilisés à la place du NIR. » pour les autres causes (société illisible, clé absente de `PAYFIT_API_KEYS`).
- `rule-evp-payfit-scope-coverage` (inferred, decision D-0019) : le contrôle de portée n'a lieu que pour les sociétés lues pendant la lecture d'Aqoona, soit celles dont une crèche a au moins une ligne avec un NIR de clé juste dans la fenêtre (`rule-evp-aqoona-nir-lazy`, inchangée). Une société sans ligne Aqoona à NIR n'est pas introspectée : aucune anomalie « Rapprochement par NIR indisponible » pour elle, même si sa clé n'a pas la portée.
- `rule-evp-payfit-scope-read-only` (inferred) : l'introspection est le seul `POST` ; aucune portée n'est demandée par le code (`rule-evp-payfit-scopes`, inchangée).

### Clé de contrôle du NIR
- `rule-evp-nir-key-formula` (user) : la clé de contrôle d'un NIR est `97 − (N mod 97)`, où `N` est le nombre formé des 13 premiers chiffres. Elle s'écrit sur 2 chiffres (`01` à `97`). Pour la Corse, `2A` vaut `19` et `2B` vaut `18` dans le calcul (les deux caractères du département sont remplacés par ces deux chiffres). Un NIR complet compte 15 caractères (séparateurs retirés, `rule-evp-aqoona-nir-format`).
- `rule-evp-nir-key-vectors` (inferred) : exemples de recette (NIR fictifs, aucun vrai NIR dans le dépôt) : `1 84 12 76 451 089 46` est juste (reste 51, clé 46), `1 84 12 76 451 089 47` est faux ; `1 85 03 2A 004 012 38` est juste (`2A` → 19, reste 59) et `1 85 03 2B 004 012 65` est juste (`2B` → 18, reste 32) ; `1 85 03 2A 004 012 65` est faux (la clé de `2B` ne vaut pas pour `2A`). Une clé `00` est toujours fausse.
- `rule-evp-nir-key-both-sides` (user) : la clé est vérifiée des deux côtés, Aqoona (`user_matricule`) et PayFit (champ NIR de la collaboratrice), lorsqu'elle est présente. Côté PayFit, une valeur de 13 caractères (sans clé) n'est pas vérifiable : elle reste utilisée comme aujourd'hui (comparaison sur les 13 premiers, `rule-evp-aqoona-nir-format`) et ne produit aucune anomalie (`rule-evp-nir-key-absent-ok`, inferred).
- `rule-evp-nir-key-invalid-unused` (user) : un NIR dont la clé est fausse ne sert pas au rapprochement. Côté Aqoona, la ligne est traitée comme une ligne sans NIR : rapprochement par prénom et nom (`rule-evp-aqoona-nir-fallback-name`), et elle ne provoque pas à elle seule la lecture des NIR de sa société (`rule-evp-aqoona-nir-lazy`). Côté PayFit, la collaboratrice est retirée de la table des NIR en mémoire : elle ne peut être trouvée que par ses noms ; en particulier elle ne rend pas ambigu (`rule-evp-aqoona-nir-ambiguous`) un NIR valide porté par une autre collaboratrice de la société.
- `rule-evp-nir-key-never-shown` (user) : la valeur d'un NIR à clé fausse n'est jamais affichée ni conservée (`rule-evp-aqoona-nir-never-stored`, user) : ni dans une réponse, une anomalie, un message, un journal d'audit ou applicatif, une notification, ni sous forme d'empreinte, de fragment ou d'indication sur les chiffres fautifs (la clé attendue n'est pas donnée non plus). `redactSecrets()` / `maskNirs()` s'appliquent aussi à ces textes.
- `rule-evp-nir-key-anomaly-grain` (inferred) : une anomalie par personne distincte (« Prénom NOM » nettoyé, `normalise()` pour comparer), pas par créneau ni par société ; le nombre de créneaux concernés figure dans le détail côté Aqoona.
- `rule-evp-nir-key-no-failure` (inferred) : ces anomalies ne rendent la lecture ni `PARTIAL` ni `FAILED`, et n'empêchent ni le stockage ni le rattachement par les noms.
- `rule-evp-nir-key-anomaly-without-company` (inferred, backend, decision D-0017) : une ligne Aqoona de clé fausse donne l'anomalie « Clé de NIR Aqoona incorrecte » quelle que soit la crèche, y compris quand l'établissement ne désigne aucune crèche du référentiel (en plus de « Planning non rattaché »).
- `rule-evp-nir-key-payfit-anomaly-source` (inferred, decision D-0018) : les NIR de PayFit n'étant lus que pendant la lecture d'Aqoona (`rule-evp-aqoona-nir-transient-key`), la clé fausse côté PayFit est contrôlée là et signalée dans les anomalies d'Aqoona, pour les seules sociétés lues. La lecture PayFit ne lit aucun NIR et `GET /sources/payfit/anomalies` ne contient jamais cette anomalie.

### Types d'anomalies ajoutés (source `aqoona`)
| Type | Libellé (`label`) | `subject` | `detail` |
|---|---|---|---|
| `aqoona_nir_key_invalid` | Clé de NIR Aqoona incorrecte | « Prénom NOM » de la ligne Aqoona (1..100 caractères), sans valeur d'apparence NIR | « N créneau(x) : la clé de contrôle du NIR est incorrecte, le prénom et le nom sont utilisés. » |
| `payfit_nir_key_invalid` | Clé de NIR PayFit incorrecte | « Prénom NOM » de la collaboratrice (nom lu dans `payfit_employees` ; à défaut « Collaboratrice <identifiant PayFit> ») | « Société <SIRET> : la clé de contrôle du NIR est incorrecte, ce NIR n'est pas utilisé. » |
| `aqoona_nir_unavailable` (existant) | Rapprochement par NIR indisponible | SIRET de la société | selon la cause (voir `rule-evp-payfit-scope-detail`) |

### Taux de rattachement
- `rule-evp-matching-rates-route` (user) : l'écran Sources lit les taux de rattachement par société ; mêmes droits que `GET /sources` (`rule-evp-matching-rates-same-rights`, user).
- `rule-evp-matching-rates-three-parts` (inferred) : chaque créneau est compté dans une seule des trois parts, selon `match_method` (`NIR` → `byNir`, `NOM` → `byName`, `AUCUN` → `unmatched`).
- `rule-evp-matching-rates-company` (inferred) : la société d'un créneau est `aqoona_plannings.company_id` ; les créneaux dont `company_id` est nul forment la ligne sans société (décision D-0015). Le nom de la société et son SIRET viennent de `payfit_companies`.
- `rule-evp-matching-rates-no-company` (inferred, decision D-0015) : dernière ligne `companyId: null`, `siret: null`, `name: "Sans société identifiée"` pour les créneaux sans société (ou dont la société n'est plus dans `payfit_companies`), de sorte que le tableau compte tous les créneaux lus.
- `rule-evp-matching-rates-live` (inferred) : le calcul est fait à la demande sur les créneaux stockés ; aucune table d'agrégats, aucun historique.
- `rule-evp-matching-rates-consistency` (inferred) : somme des `total` = volume « Plannings lus » ; somme des `byNir.count` = « Rapprochés par NIR » ; somme de `byNir.count` et `byName.count` = « Plannings rattachés » (decision D-0015). Ces égalités valent après une lecture sans adresse en échec : les créneaux conservés d'une adresse en échec (`rule-evp-sources-partial-failure`) sont dans les taux mais pas dans les volumes de la lecture.
- `rule-evp-matching-rates-unknown-mode` (inferred, backend, decision D-0016) : tant qu'un créneau stocké a le mode `INCONNU`, la réponse est `available: false` avec `items` vide ; aucun taux partiel, aucune quatrième part.
- `rule-evp-matching-rates-no-nir` (user) : la réponse ne contient ni NIR ni nom de personne.

## Compatibilité
- Une route ajoutée (`GET /sources/aqoona/matching-rates`, action `sources:matching-rates`) : additive. `specifications/permissions.yaml` (QA) doit recevoir l'entrée (capacité `sources:read`, rôles RH et superadmin, règles `rule-evp-matching-rates-*`) ; `specifications/openapi.json` est régénéré par la porte de contrat. Aucune opération existante ne change de forme : pas de rupture de contrat.
- `GET /sources/{key}/anomalies` : deux types nouveaux et un détail nouveau pour un cas qui était auparavant silencieux (portée manquante) ; schéma inchangé (`type`, `label`, `subject`, `detail` : chaînes). Le test de la v3 qui pose un NIR PayFit à clé fausse ou qui suppose qu'une portée absente est sans anomalie est à revoir par QA : les NIR fictifs de recette doivent désormais avoir une clé juste (voir `rule-evp-nir-key-vectors`) pour être utilisés au rapprochement.
- Fixtures du pilote `fake` : `payfit.json` gagne un champ facultatif `nirScopeMissing` (liste de SIRET) qui simule l'introspection sans la portée (distinct de `nirUnavailable`, qui simule une société illisible) ; les NIR fictifs des fixtures portent une clé juste, sauf ceux qui servent à éprouver la clé fausse. Aucun vrai NIR dans le dépôt, les fixtures ou les captures.
- Pilote `real` : l'appel d'introspection existe déjà (identifiant de société) ; il est aussi lu pour `scope`. Le format de `scope` est supposé (voir `rule-evp-payfit-scope-format`) et reste à confirmer au premier essai réel, comme `PAYFIT_NIR_FIELD`.
- Colonne `match_method` : voir « Stockage ». La fabrication ouvre `OPEN: contract data-contract : match_method sur aqoona_plannings` si QA y voit une extension du schéma `base`.
- Aucune variable d'environnement nouvelle.
