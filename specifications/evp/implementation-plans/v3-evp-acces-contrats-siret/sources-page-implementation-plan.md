# Écran Sources (`/sources`) : plan de réalisation (v3)

Objet : l'écran montre la lecture Aqoona « Pros » réelle (créneaux, rattachements par NIR, anomalies de types de créneau) et la lecture PayFit à plus de 35 sociétés, sans jamais montrer un NIR. Les libellés de volumes et d'anomalies viennent de l'API ; l'écran ne se protège en plus que contre l'affichage d'une valeur d'apparence NIR.

Les plans de la v1 (`../v1-evp/sources-page-implementation-plan.md`) et de la v2 (`../v2-evp-sources/sources-page-implementation-plan.md`) restent la référence pour tout ce qui n'est pas dit ici. La demande à l'API est `sources-api-modification-request.md`.

## Parcours
Inchangé. Compléments :
1. La carte Aqoona liste ses volumes tels que l'API les envoie : « Plannings lus », « Plannings rattachés », « Rapprochés par NIR ». « Matricule écarté » ne s'affiche plus.
2. Le panneau d'anomalies d'Aqoona peut montrer, en plus des types de la v2 : « Type de créneau Aqoona inconnu », « Créneau Aqoona sans type », « Rapprochement par NIR indisponible », et pour « Planning non rattaché » le détail « Rattachement par NIR ambigu ». Une salariée présente dans deux établissements le même jour n'y apparaît pas : ce n'est pas une anomalie.
3. Avec plus de 35 sociétés PayFit, la carte PayFit affiche le volume « Sociétés » en conséquence ; un échec isolé donne « Lecture partielle » et « Société inaccessible » pour chaque société concernée, paginées dans le panneau (10 / 25 / 50).

## Éléments à l'écran
Éléments de la v1 et de la v2 conservés avec leurs libellés. Ajouts :

| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Volume Aqoona ajouté | « Rapprochés par NIR » (nombre, format français) | Comptage de créneaux rapprochés par NIR ; jamais le NIR | `GET /sources` (`volumes`) |
| Volume Aqoona retiré | « Matricule écarté » | N'est plus produit par l'API, donc plus affiché | — |
| Type d'anomalie Aqoona ajouté | « Type de créneau Aqoona inconnu » | Colonne « Type » ; « Élément concerné » = le type normalisé ; « Détail » = nombre de créneaux | `GET /sources/aqoona/anomalies` |
| Type d'anomalie Aqoona ajouté | « Créneau Aqoona sans type » | « Élément concerné » = libellé de l'adresse ; « Détail » = nombre de créneaux | idem |
| Type d'anomalie Aqoona ajouté | « Rapprochement par NIR indisponible » | « Élément concerné » = SIRET de la société ; « Détail » = « Les noms sont utilisés à la place du NIR. » | idem |
| Détail ajouté de « Planning non rattaché » | « Rattachement par NIR ambigu » | Texte de l'API | idem |
| Adresse lue (Aqoona) | « Adresse lue : <libellé> : https://hôte/chemin?… » (inchangé) | `dateBegin` et `dateEnd`, ajoutés par l'API à l'adresse, ne sont pas montrés non plus (tout ce qui suit `?` est remplacé) | `addresses` |

## Réalisation (studio)
Un seul fichier existant change : `studio/src/app/features/sources/pages/SourcesPage.tsx` (aucune page, route ni composant nouveau ; types de `@evpms/api-client`).
- Aucun libellé de volume ou d'anomalie n'est codé dans l'écran : les nouveaux s'affichent sans code.
- Défense en profondeur (comme `maskAddress()` pour les adresses) : une fonction du fichier, appliquée aux libellés de volumes, au `subject` et au `detail` des anomalies et au message `lastError.message` avant affichage, remplace par « … » toute suite d'apparence NIR, soit 13 chiffres (ou `2A`/`2B` en 6e et 7e positions) suivis éventuellement de 2 chiffres de clé, espaces, points et tirets compris, délimitée par des non-chiffres. Un SIRET (14 chiffres) n'est pas touché. Aucun comptage ni calcul n'est fait par le studio.

## Règles
- `rule-evp-aqoona-nir-never-stored` (user, decision D-0010) : le NIR n'apparaît jamais à l'écran : ni dans les cartes, ni dans les volumes, ni dans les anomalies, ni dans les messages d'erreur ; l'écran n'affiche que des décomptes et des SIRET.
- `rule-evp-aqoona-nir-transient-key` (user, decision D-0010) : « Rapprochés par NIR » est un décompte ; l'écran ne montre aucune donnée d'une collaboratrice PayFit tirée du NIR. Cette règle remplace, pour le flux « Pros », `rule-evp-sources-nir-discarded` (user) : le volume « Matricule écarté » n'existe plus.
- `rule-evp-aqoona-multi-siret-same-day` (user) : une salariée dans deux établissements le même jour ne produit aucune anomalie à l'écran.
- `rule-evp-payfit-many-keys` (user) : l'écran supporte plus de 35 sociétés (volume, anomalies paginées) sans changement de présentation.
- `rule-evp-aqoona-read-pros` (user) : l'écran présente Aqoona comme une seule source ; il ne distingue pas les adresses « Planning » et « Pros » (seule « Pros » est lue), il liste ses adresses lues masquées (`rule-evp-aqoona-mask`, user).
- `rule-evp-secrets-never-exposed` (user, inchangée) : ni clé, ni adresse complète, ni `securityCheck`, ni NIR.
- `rule-evp-sources-nir-redaction-studio` (inferred) : la défense de `SourcesPage.tsx` ci-dessus.
- Inchangées : `rule-evp-sources-screen`, `rule-evp-sources-failure-state`, `rule-evp-sources-readonly`, `rule-evp-sources-manual`, `rule-evp-sources-sheets-superadmin`, `rule-evp-sources-payfit-aqoona-manual`, `rule-evp-sources-windows`, `rule-evp-sources-no-invention`, `rule-evp-sources-ro-gaps-not-overwritten`, `rule-evp-sources-no-auto-absence`, `rule-evp-sources-workspace-scope`, `rule-evp-sources-partial-failure`, `rule-evp-sources-guard`, `rule-evp-sources-run-polling`, `rule-evp-sources-refresh-audited`.

## Accès
Inchangé : RH (PayFit et Aqoona) et superadmin (toutes les sources) ; directrice, RO, administratrice : « Accès refusé ».

## Hypothèses
- Le volume et les noms d'anomalies sont ceux de `sources-api-modification-request.md` ; si l'API en change un libellé, l'écran le suit sans modification.
- Les tests de navigateur ne contrôlent que l'absence de NIR (un NIR fictif posé dans la fixture ne se lit nulle part à l'écran) et la présence des libellés ci-dessus.
- Le mot « NIR » dans les libellés est un terme du vocabulaire de la demande, pas une valeur ; le studio le laisse tel quel.
- Aucun bouton ni lien pour choisir entre « Planning » et « Pros » : la lecture retenue par EVP est « Pros ».
