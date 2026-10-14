# Demande à l'API : lecture Aqoona « Pros », NIR comme clé de liaison transitoire, plus de 35 SIRET

Écran demandeur : Sources (`/sources`). Besoin : que la lecture Aqoona suive le format réel de l'adresse « Pros », rattache chaque créneau à la bonne collaboratrice PayFit (par NIR transitoire, sinon par prénom et nom) sans jamais conserver le NIR, qu'elle gère les professionnelles présentes dans deux établissements le même jour, et que la lecture PayFit tienne avec plus de 35 clés.

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /sources` | `sources:list` (inchangé) | capacité `sources:read` (inchangé) | aucune | forme inchangée. Pour `aqoona`, `volumes` devient « Plannings lus », « Plannings rattachés », « Rapprochés par NIR » (« Matricule écarté » n'est plus produit) ; `addresses[]` inchangé (libellé, adresse masquée) |
| `POST /sources/{key}/refresh`, `POST /sources/refresh-all`, `GET /sources/runs/{id}` | inchangées | inchangés | inchangée | inchangées |
| `GET /sources/{key}/anomalies` | `sources:anomalies` (inchangé) | inchangé | inchangée | inchangée de forme ; types ajoutés pour `aqoona` (tableau ci-dessous) ; `subject` et `detail` ne contiennent jamais de NIR |

Aucune route nouvelle ni retirée. `label` d'un volume reste 1..100 caractères.

## Adresses et paramètres Aqoona
- Deux adresses existent chez Aqoona, « Planning » (jours contractuels) et « Pros » (`generateMicrostarsPlanningPros.php`, planning détaillé). **EVP lit « Pros » seule** ; `AQOONA_URLS` ne contient que cette adresse (une entrée par société si plusieurs, comme avant) et l'adresse « Planning » n'est jamais appelée.
- Chaque adresse est protégée par le paramètre `securityCheck` (secret), déjà inclus dans l'adresse configurée, jamais écrit en clair ailleurs (masquage `?…` inchangé).
- À chaque lecture, EVP ajoute à l'adresse `dateBegin` et `dateEnd` (`AAAA-MM-JJ`, jour de Paris) réglés sur la fenêtre de lecture : `dateBegin` = J−28, `dateEnd` = J+35. Un `dateBegin` ou `dateEnd` déjà présent dans l'adresse configurée est remplacé. Le filtre local de la fenêtre est conservé (les créneaux hors fenêtre sont ignorés).
- Chaque réponse est un tableau JSON à la racine (`records` vaut `""` dans le fichier de correspondance). Une réponse d'une autre forme ou plus de la moitié de lignes inexploitables reste `sources.unexpected_format` (`rule-evp-aqoona-unexpected-format`, inchangée).

## Fichier de correspondance (définitif)
`api/config/aqoona-mapping.json` suit le format « Pros » et n'est plus provisoire :
```json
{
  "records": "",
  "fields": {
    "matricule": "user_matricule",
    "prenom": "user_firstname",
    "nom": "user_lastname",
    "creche": "etablissement_name",
    "jour": "planning_days_date",
    "debut": "planning_days_heure_debut",
    "fin": "planning_days_heure_fin",
    "type": "planning_days_type_creneau"
  },
  "dayFormat": "YYYY-MM-DD",
  "timeFormat": "HH:mm",
  "slotTypes": {
    "GARDE": ["garde", "garde enfant", "terrain"],
    "PAUSE": ["pause", "pauses"],
    "MENAGE": ["menage", "entretien"]
  }
}
```
La clé `matricule` du fichier désigne le champ `user_matricule` de « Pros », qui ne sert qu'à porter un NIR éventuel ; le champ `type` est nouveau et facultatif dans le format (absent du fichier = tous les créneaux sans type). Les alias de `slotTypes` sont écrits sous leur forme normalisée (voir ci-dessous).

## Règles
### Lecture « Pros »
- `rule-evp-aqoona-read-pros` (user) : EVP lit l'adresse « Pros » (planning détaillé) ; l'adresse « Planning » n'est pas lue.
- `rule-evp-aqoona-window-params` (user) : EVP règle `dateBegin` et `dateEnd` sur sa fenêtre de lecture (J−28 à J+35), `AAAA-MM-JJ`.
- `rule-evp-aqoona-get-only` (inferred, révisée) : un seul `GET` par adresse, sans en-tête d'authentification, redirections non suivies, `Accept: application/json`, réponse limitée à 20 Mo ; seuls `dateBegin` et `dateEnd` sont ajoutés ou remplacés dans l'adresse, aucun autre paramètre (`securityCheck` y est déjà).
- `rule-evp-aqoona-root-array` (user) : la réponse est un tableau JSON à la racine, une ligne par créneau.
- `rule-evp-aqoona-mapping-final` (user) : le fichier livré suit le format ci-dessus ; il remplace `rule-evp-aqoona-mapping-provisional`. `rule-evp-aqoona-field-mapping`, `rule-evp-aqoona-fields`, `rule-evp-aqoona-window`, `rule-evp-aqoona-url-secret`, `rule-evp-aqoona-mask` (user) restent vraies.
- `rule-evp-aqoona-slots` (user) : la journée d'une salariée est découpée en créneaux contigus (Garde, PAUSE, Garde, MENAGE…) ; chaque ligne est un créneau stocké séparément ; EVP ne fusionne pas les créneaux et n'en déduit aucune présence ni absence (`rule-evp-sources-no-auto-absence`, inchangée).
- `rule-evp-aqoona-dedupe` (inferred) : deux lignes identiques (même personne, même établissement, même jour, mêmes heures, même type) sont stockées une seule fois ; le décompte « Plannings lus » compte les créneaux stockés dans la fenêtre.

### Normalisation des données réelles
- `rule-evp-aqoona-text-normalised` (user) : les noms de personnes et d'établissements sont nettoyés des espaces parasites (début, fin, répétés) avant tout usage ; la comparaison ignore casse, accents et ponctuation (`normalise()`), en plus, pour les établissements, des espaces (« Micro-Stars », « MicroStars » et « Micro Stars » sont le même établissement).
- `rule-evp-aqoona-etab-unique` (inferred) : un créneau est rattaché à une crèche seulement si son établissement correspond à une seule crèche vérifiée du référentiel ; sinon il est stocké sans crèche et signalé « Planning non rattaché » (`rule-evp-sources-no-invention`, inchangée).
- `rule-evp-aqoona-person-ref` (inferred) : `aqoona_plannings.person_ref` vaut toujours « Prénom NOM » nettoyé, jamais la valeur de `user_matricule`.
- `rule-evp-aqoona-slot-type-normalised` (user) : le type de créneau est normalisé (espaces nettoyés, casse, accents et pluriel ignorés par comparaison aux alias de `slotTypes`) : Garde, garde, GARDE, Garde enfant, Terrain → `GARDE` ; PAUSE, Pause, pauses → `PAUSE` ; Menage, MENAGE, Ménage, Entretien → `MENAGE`. Un type vide ou absent → `NON_PRECISE` ; un type non vide inconnu → `AUTRE`. La table d'alias vit dans le fichier de correspondance (inferred).
- `rule-evp-aqoona-slot-type-anomalies` (inferred) : les types `AUTRE` donnent une anomalie par type distinct, les types `NON_PRECISE` une seule anomalie avec le décompte ; ces anomalies n'empêchent ni le stockage ni le rattachement.

### Le NIR, clé de liaison transitoire
- `rule-evp-aqoona-nir-transient-key` (user, decision D-0010) : le NIR présent dans « Pros » sert de clé transitoire pour lier une ligne Aqoona à la collaboratrice PayFit qui porte le même NIR (portée PayFit « Social security number »). Pendant une lecture Aqoona, EVP lit en mémoire, en lecture seule, les NIR des collaboratrices des sociétés concernées et rapproche les lignes en mémoire. Cette règle remplace, pour le flux « Pros », l'écartement des valeurs d'apparence NIR de `rule-evp-sources-nir-discarded` (v1, v2) : « Matricule écarté » n'existe plus.
- `rule-evp-aqoona-nir-never-stored` (user, decision D-0010) : EVP ne conserve que le résultat du rapprochement (`aqoona_plannings.company_id` et `employee_id`, l'identifiant PayFit de la collaboratrice), jamais le NIR : ni dans une table (Aqoona, PayFit, anomalies, écarts, journal d'audit, notifications), ni dans les journaux applicatifs, les écrans, les exports, les anomalies ou les messages d'erreur ; ni sous forme d'empreinte, de fragment ou de valeur dérivée. `redactSecrets()` masque en plus toute chaîne d'apparence NIR dans les messages avant journalisation, stockage et réponse (`rule-evp-secrets-never-exposed`, user). `payfit_employees` ne reçoit jamais le NIR, même si PayFit le renvoie.
- `rule-evp-aqoona-nir-format` (inferred) : une valeur de `user_matricule` compte comme NIR si, espaces, points et tirets retirés, elle comporte 13 chiffres (ou `2A`/`2B` à la place des 6e et 7e chiffres, le département) suivis de la clé à 2 chiffres, soit 15 caractères. Toute autre valeur est traitée comme absente et n'est conservée nulle part. Côté PayFit, la comparaison porte sur les mêmes caractères normalisés ; si PayFit ne livre que les 13 premiers, elle porte sur les 13 premiers.
- `rule-evp-aqoona-nir-over-name` (user) : un NIR qui correspond à une seule collaboratrice de la société de la crèche l'emporte, même si le prénom et le nom d'Aqoona diffèrent de ceux de PayFit.
- `rule-evp-aqoona-nir-fallback-name` (user) : sans NIR, ou si le NIR ne correspond à aucune collaboratrice de la société, le rapprochement se fait comme aujourd'hui par prénom et nom (comparaison `normalise()`, collaboratrice unique dans la société de la crèche, sinon « Planning non rattaché »).
- `rule-evp-aqoona-nir-scope-company` (inferred) : la recherche par NIR se limite à la société PayFit de la crèche de l'établissement de la ligne (SIRET de la crèche) ; une collaboratrice qui ne porte ce NIR que dans une autre société ne compte pas.
- `rule-evp-aqoona-nir-ambiguous` (inferred, decision D-0014) : le propriétaire tient ce cas pour impossible, ou pour une même personne avec deux contrats. Dans PayFit, une personne avec deux contrats est **une seule collaboratrice** (un seul identifiant, deux contrats) : le NIR ne désigne alors qu'une collaboratrice et rattache normalement. Seuls des identifiants de collaboratrices **distincts** portant le même NIR dans la même société forment le cas ambigu. Il ne rattache rien et ne retombe pas sur les noms (le cas n'est pas celui d'un NIR sans correspondance) ; le créneau est stocké sans collaboratrice et signalé « Planning non rattaché » avec le détail « Rattachement par NIR ambigu » (`rule-evp-sources-no-invention`).
- `rule-evp-aqoona-nir-unavailable` (inferred) : si les NIR d'une société ne peuvent pas être lus (portée « Social security number » absente de la clé, société injoignable, clé absente de `PAYFIT_API_KEYS`), les lignes de cette société se rapprochent par prénom et nom et une anomalie « Rapprochement par NIR indisponible » (`subject` = SIRET de la société) est créée ; la lecture Aqoona n'échoue pas et n'est pas `PARTIAL` pour cette raison.
- `rule-evp-aqoona-nir-lazy` (inferred) : PayFit n'est interrogé pendant la lecture Aqoona que pour les sociétés des crèches qui ont au moins une ligne portant un NIR dans la fenêtre ; l'appel est en lecture seule (`rule-evp-sources-readonly`, `rule-evp-payfit-scopes`) et n'écrit rien dans les tables PayFit ; il n'interfère pas avec une lecture PayFit en cours.

### Plusieurs SIRET, plus de 35 clés
- `rule-evp-payfit-many-keys` (user) : le réseau compte plus de 35 SIRET, donc plus de 35 clés PayFit ; la lecture PayFit prend en charge au moins les 100 entrées que `PAYFIT_API_KEYS` accepte déjà, une société à la fois, sans limite de volume propre à EVP ; un échec isolé reste une lecture partielle (`rule-evp-sources-partial-failure`).
- `rule-evp-employee-multi-company` (user) : une professionnelle à cheval sur plusieurs SIRET est une collaboratrice distincte dans chaque société PayFit ; EVP la tient pour deux (société + collaboratrice) et ne les fusionne jamais par le nom.
- `rule-evp-aqoona-multi-siret-same-day` (user) : une même salariée présente dans deux établissements le même jour donne deux séries de créneaux conservées ensemble, chacune rattachée à la crèche de son établissement et, par la société de cette crèche, à sa collaboratrice PayFit ; ce n'est ni une anomalie, ni un doublon, ni un chevauchement à arbitrer.
- `rule-evp-aqoona-partial-failure` (inferred, inchangée, D-0007) : une adresse en échec garde ses créneaux précédents ; état `PARTIAL`.

## Types d'anomalies Aqoona ajoutés
| Type | Libellé (`label`) | `subject` | `detail` |
|---|---|---|---|
| `aqoona_slot_type_unknown` | Type de créneau Aqoona inconnu | le type normalisé, 1..100 caractères, sans valeur d'apparence NIR | « N créneau(x) rangé(s) en « autre » » |
| `aqoona_slot_type_missing` | Créneau Aqoona sans type | libellé de l'adresse | « N créneau(x) sans type » |
| `aqoona_nir_unavailable` | Rapprochement par NIR indisponible | SIRET de la société | « Les noms sont utilisés à la place du NIR. » |
| `PLANNING_UNMATCHED` (existant) | Planning non rattaché | « Prénom Nom » | raison existante, ou « Rattachement par NIR ambigu » |

## Compatibilité
- `GET /sources` : seule la liste des libellés de volume d'Aqoona change (« Matricule écarté » retiré, « Rapprochés par NIR » ajouté), sans changement de schéma ; le test v1/v2 qui attend « Matricule écarté » est à remplacer par QA (`rule-evp-sources-nir-discarded` remplacée par `rule-evp-aqoona-nir-transient-key` pour le flux « Pros »).
- Colonne ajoutée à `base.aqoona_plannings` (table de la fonctionnalité `sources`, hors `data-contract.md`) : `slot_type` texte non nul, valeurs `GARDE`, `PAUSE`, `MENAGE`, `AUTRE`, `NON_PRECISE`, défaut `NON_PRECISE`, contrainte `check` ; migration par `pnpm migrate:gen`. Aucune colonne ne porte de NIR. La fabrication ouvre `OPEN: contract data-contract : slot_type sur aqoona_plannings` si QA y voit une extension du schéma `base`.
- `api/config/aqoona-mapping.json` est remplacé (hors dossiers figés) ; `AQOONA_MAPPING_FILE` garde son rôle. Les tests v2 qui posent leurs propres champs par ce fichier ou par `aqRow` doivent suivre les nouveaux noms de champs « Pros » : à mettre à jour par QA.
- `api/.env.template` : pas de nouvelle variable (la portée PayFit « Social security number » se règle côté PayFit, la fenêtre côté code).
- Les fixtures du pilote `fake` portent des lignes au format « Pros », avec NIR fictifs, pour la recette ; aucun vrai NIR dans le dépôt, les fixtures ou les captures.
- NIR des collaboratrices PayFit sous le pilote `fake` (decision D-0010) : un champ facultatif `nir` sur chaque collaboratrice de `payfit.json`, lu seulement pendant la lecture Aqoona et jamais copié dans `payfit_employees` ; un champ facultatif `nirUnavailable` (liste de SIRET) simule la portée absente (`rule-evp-aqoona-nir-unavailable`). Pas de fichier de fixture séparé. Les tests posent le NIR fictif dans `payfit.json` et vérifient qu'il n'est ni en base, ni dans les réponses, ni dans l'audit, ni dans les journaux.
