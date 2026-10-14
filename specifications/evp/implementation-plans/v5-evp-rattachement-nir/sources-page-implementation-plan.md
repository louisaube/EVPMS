# Écran Sources (`/sources`) : plan de réalisation (v5)

Objet : l'écran Sources compte désormais le rattachement d'Aqoona en personnes (par société : salariées rattachées par leur NIR, personnes non reliées, avec leur part) et liste nommément les personnes non reliées entre Aqoona et PayFit, avec la cause et la crèche, pour que RH corrige la donnée à la source. Il nomme aussi la société dans les anomalies de portée et montre dans les anomalies de PayFit les clés sans la portée « numéro de sécurité sociale ». Il n'affiche jamais un NIR.

Les plans de la v1 (`../v1-evp/sources-page-implementation-plan.md`), de la v2, de la v3 et de la v4 (`../v4-evp-fiabilite-nir/sources-page-implementation-plan.md`) restent la référence pour tout ce qui n'est pas dit ici. La demande à l'API est `sources-api-modification-request.md`. Les choix sont tranchés dans `questions.yaml` et le registre : D-0020 (Q-EVP-19, A), D-0021 (Q-EVP-20, B), D-0022 (Q-EVP-21, A), D-0023 (Q-EVP-22, A), D-0024 (Q-EVP-23, A). Q-EVP-20 et Q-EVP-23 donnent à l'écran une cause de plus dans la liste (« NIR non vérifié : lecture PayFit incomplète ») ; Q-EVP-22 fait figurer une même personne dans les rattachées et dans la liste ; les autres ne changent que les chiffres et les anomalies fournis par l'API.

## Parcours
Inchangé pour les cartes, l'actualisation, le suivi et le panneau d'anomalies. Compléments :
1. Sous les cartes, la section de la v4 « Rattachement des créneaux Aqoona » est remplacée par « Rattachement des personnes Aqoona » : un tableau, une ligne par société, en personnes. Elle se charge seule (indicateur `role="status"`, ou erreur avec « Réessayer » dans la section, sans masquer les cartes).
2. Juste dessous, une seconde section « Personnes non reliées entre Aqoona et PayFit » liste les personnes non reliées, paginée. Elle se charge seule, indépendamment de la première (l'échec de l'une ne masque pas l'autre).
3. États sans tableau, avec un texte (`role="status"`), communs aux deux sections (mêmes conditions côté API, `available`) :
   - Aqoona jamais lue : « Aqoona n'a pas encore été lue : le rattachement des personnes apparaîtra après la première lecture. »
   - Créneaux écrits avant la v5 (mode de rattachement par nom ou inconnu) : « Le rattachement des personnes sera disponible après la prochaine lecture complète d'Aqoona. »
   - Aqoona lue, aucune personne dans la fenêtre (taux) : « Aucune personne dans les plannings Aqoona de la fenêtre lue. »
   - Aqoona lue, liste vide : « Toutes les personnes des plannings Aqoona sont reliées à PayFit. »
4. À la fin d'une lecture lancée depuis l'écran (ou suivie), les deux sections sont relues avec les cartes. Une lecture de PayFit ne change pas leurs chiffres ; elle change les anomalies de PayFit (point 6) et, à la lecture d'Aqoona suivante, le rattachement.
5. La liste se parcourt par pages (10 / 25 / 50 par page, 25 par défaut, comme le panneau d'anomalies) ; changer de page ou de taille relit la route de la liste seule, sans relire les taux ni les cartes. Revenir à la page 1 quand la taille change ou quand la section est relue après une lecture.
6. Le panneau d'anomalies de PayFit peut montrer deux types de plus : « Portée PayFit manquante » et « Introspection de la clé PayFit en échec », une ligne par société concernée, chacune avec « Élément concerné » = « <Nom de la société> (SIRET <14 chiffres>) ». Le panneau d'anomalies d'Aqoona montre « Rapprochement par NIR indisponible » avec la société nommée de la même façon, « Planning non rattaché » avec comme détail la cause (« NIR absent dans Aqoona », « NIR inconnu de PayFit », etc.) et la crèche lue, et le nouveau type « Ligne Aqoona sans nom ni NIR ». Les libellés viennent de l'API ; l'écran n'en code aucun.
7. Aucune action nouvelle : tout est en lecture seule (pas d'export, de correction, de lien vers PayFit ou Aqoona, ni de rattachement manuel).

## Éléments à l'écran
Éléments des versions précédentes conservés avec leurs libellés, sauf la section des taux de la v4, remplacée. Ajouts et remplacements :

| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Section (remplace celle de la v4) | titre de niveau 2 « Rattachement des personnes Aqoona » | Sous les cartes ; tableau ou texte d'état ; relue après chaque lecture | `GET /sources/aqoona/matching-rates` |
| Tableau | nom accessible « Taux de rattachement des personnes Aqoona par société » | Une ligne par élément de `items`, dans l'ordre de l'API (nom croissant, ligne sans société en dernier) | idem |
| Colonne | « Société » | En-tête de ligne : nom, puis « SIRET <14 chiffres> » (absent pour la ligne sans société) | `items[].name`, `items[].siret` |
| Colonne | « Personnes » | Total de personnes distinctes de la société, format français | `items[].total` |
| Colonne | « Rattachées par leur NIR » | Cellule « 75,0 % (3) » : part, puis effectif entre parenthèses, virgule, une décimale | `items[].linked` |
| Colonne | « Non reliées » | Même format | `items[].unlinked` |
| Ligne sans société | « Sans société identifiée » (libellé de l'API) | Personnes non reliées dont la crèche n'a pas de société PayFit unique ; mêmes colonnes, sans SIRET | `items[]` avec `companyId` nul |
| Pied de section | « Plannings lus du <jj/mm/aaaa> au <jj/mm/aaaa>, d'après la lecture d'Aqoona du <jj/mm/aaaa> à <hh:mm>. » | Fenêtre et dernière lecture réussie, fournies par l'API | `windowFrom`, `windowTo`, `lastReadAt` |
| Note de lecture | « Une personne est rattachée quand son NIR dans Aqoona est celui d'une collaboratrice PayFit du réseau, quelle que soit sa société ; elle compte pour sa société PayFit de référence. Sans NIR exploitable, elle n'est pas reliée : le prénom et le nom ne servent jamais au rattachement. » | Texte fixe sous le tableau | — |
| Section | titre de niveau 2 « Personnes non reliées entre Aqoona et PayFit » | Sous la section des taux ; tableau paginé ou texte d'état | `GET /sources/aqoona/unlinked-people` |
| Tableau | nom accessible « Personnes non reliées entre Aqoona et PayFit » | Une ligne par élément de `items` dans l'ordre de l'API (nom, puis cause) | idem |
| Colonne | « Personne » | « Prénom NOM » lu dans Aqoona ; « Personne non nommée » si la ligne n'a pas de nom (libellé de l'API) | `items[].name` |
| Colonne | « Cause » | Libellé français de l'API, texte seul (pas de couleur seule, pas de code affiché) : « NIR absent dans Aqoona », « Clé du NIR incorrecte dans Aqoona », « NIR inconnu de PayFit », « NIR porté par plusieurs collaboratrices PayFit », « NIR non vérifié : lecture PayFit incomplète » | `items[].causeLabel` |
| Colonne | « Crèche » | Crèches où la personne a été lue, séparées par des virgules ; « Crèche inconnue » si `creches` est vide | `items[].creches` |
| Pagination | « Lignes par page » (10 / 25 / 50), « Page précédente », « Page suivante » (MUI `TablePagination`, libellés français) | Compte `total` de l'API, formulé « 1–25 sur 130 » | `total`, `from`, `size` |
| Pied de section | « Plannings lus du <jj/mm/aaaa> au <jj/mm/aaaa>, d'après la lecture d'Aqoona du <jj/mm/aaaa> à <hh:mm>. » | Idem section des taux | idem |
| Note de lecture | « La liste nomme les personnes à corriger dans Aqoona ou dans PayFit. Elle n'affiche jamais de NIR. » | Texte fixe sous le tableau | — |
| Type d'anomalie ajouté (PayFit) | « Portée PayFit manquante » | « Élément concerné » = « <Nom> (SIRET <14 chiffres>) » ; « Détail » = la portée `collaborators:social-security:read` manque à la clé de la société | `GET /sources/payfit/anomalies` |
| Type d'anomalie ajouté (PayFit) | « Introspection de la clé PayFit en échec » | Même élément ; « Détail » = la portée n'a pas pu être vérifiée et la cause en mots | idem |
| Type d'anomalie ajouté (Aqoona) | « Ligne Aqoona sans nom ni NIR » | « Élément concerné » = libellé de l'adresse ; « Détail » = nombre de lignes | `GET /sources/aqoona/anomalies` |
| Anomalie modifiée (Aqoona) | « Rapprochement par NIR indisponible » | « Élément concerné » = « <Nom> (SIRET <14 chiffres>) » au lieu du SIRET seul ; le détail ne dit plus que les noms sont utilisés | idem |
| Anomalie modifiée (Aqoona) | « Planning non rattaché » | « Élément concerné » = prénom et nom ; « Détail » = cause et crèche lue | idem |
| Anomalie modifiée (Aqoona) | « Clé de NIR Aqoona incorrecte » | Détail : la ligne n'est pas rattachée (plus de repli sur le nom) | idem |

## Réalisation (studio)
- Réutilisation : `useLoad` + `useCall` (`shared/`), `EtatAttente` / `EtatErreur`, `formatNumber`, `formatDate`, `formatDateTime`, le formatage de pourcentage de la v4 (`PERCENT`, `partText` de `AqoonaMatchingRates.tsx`), et `usePagedList` (`shared/usePagedList.ts`, `from`/`size`, `reloadFirst`) avec le `TablePagination` du panneau d'anomalies de `SourcesPage.tsx` (mêmes tailles de page, mêmes libellés).
- `studio/src/app/features/sources/components/AqoonaMatchingRates.tsx` : réécrit pour la nouvelle forme (`linked`, `unlinked`, `total` en personnes) ; colonnes et libellés ci-dessus ; `reloadToken` conservé.
- Nouveau : `studio/src/app/features/sources/components/AqoonaUnlinkedPeople.tsx` (section, tableau, pagination, états) ; la pagination vient de `usePagedList` (appel `api.GET('/sources/aqoona/unlinked-people', { params: { query: { from, size } } })`, `size` typé `10 | 25 | 50`), pas d'état de page écrit à la main ; reçoit le même jeton de rechargement et appelle `reloadFirst()` quand il change.
- `SourcesPage.tsx` : monte les deux sections sous les cartes dans cet ordre, avec le jeton existant `ratesToken` (déjà incrémenté partout où la page relit les taux à la fin d'une lecture), passé aux deux composants. Aucune autre modification de la page.
- `redactNir()` (`components/redactNir.ts`) s'applique aussi aux noms de personnes, à la colonne « Cause » et « Crèche » avant affichage (seconde ligne de défense : l'API n'envoie aucun NIR). Un nom de personne qui prendrait l'apparence d'un NIR serait masqué.
- Types : `@evpms/api-client`, régénérés par `pnpm api-client:generate` après la modification de l'API. Le studio ne compte, ne regroupe ni ne trie rien : il met en forme.
- Accessibilité : vrais `<table>` avec `<caption>` (les noms accessibles ci-dessus, masquée visuellement), `scope="col"` et `scope="row"`, pagination au clavier ; la cause est un texte, jamais une couleur seule.

## Règles
- `rule-evp-matching-rates-people` (user) : le taux de rattachement d'Aqoona se compte en personnes (salariées distinctes rattachées par leur NIR, personnes non reliées), plus en créneaux ; l'écran montre pour chaque société les deux effectifs et leur part. Remplace `rule-evp-matching-rates-slots`, `-three-parts` et `-screen` de la v4 (plus de colonne « par prénom et nom », plus de « Créneaux lus »).
- `rule-evp-matching-rates-company-of-person` (inferred) : une personne rattachée compte pour sa société PayFit de référence ; une personne non reliée compte pour la société de chaque crèche où elle est lue, ou pour « Sans société identifiée » ; sans total général.
- `rule-evp-matching-rates-percent` (inferred, inchangée) : part arrondie à une décimale par l'API, effectifs exacts.
- `rule-evp-matching-rates-no-company` (inferred, D-0015, inchangée) : dernière ligne « Sans société identifiée ».
- `rule-evp-matching-rates-unknown-mode` (inferred, D-0016, étendue) : tant qu'un créneau stocké est d'avant la v5, aucun taux ni liste, et le texte « sera disponible après la prochaine lecture complète d'Aqoona ».
- `rule-evp-matching-rates-same-rights` (user, inchangée) et `rule-evp-unlinked-list-same-rights` (user) : mêmes droits que l'écran Sources (RH et superadmin) ; autres rôles : « Accès refusé », aucun appel aux deux routes.
- `rule-evp-unlinked-list` (user) : l'écran liste chaque personne non reliée entre Aqoona et PayFit, avec la cause et la crèche.
- `rule-evp-unlinked-list-no-nir` (user) : la liste nomme la personne, jamais un NIR ; ni fragment, ni chiffres, ni clé attendue.
- `rule-evp-unlinked-list-grain` (inferred) : une ligne par personne et par cause ; une personne dont deux causes diffèrent selon ses créneaux apparaît deux fois.
- `rule-evp-unlinked-list-paging` (inferred) : 10 / 25 / 50 par page, 25 par défaut ; le total vient de l'API.
- `rule-evp-unlinked-list-all-causes-visible` (inferred) : la colonne « Cause » montre le libellé de l'API tel quel ; avec D-0021 (Q-EVP-20, B), « NIR non vérifié : lecture PayFit incomplète » en fait partie (renvoie aux anomalies de portée de PayFit plutôt qu'à une correction du NIR).
- `rule-evp-link-nir-only` (user), `rule-evp-link-network-wide` (user), `rule-evp-link-one-establishment` (user), `rule-evp-link-unusable-nir` (user), `rule-evp-link-no-identity` (user) : comportement de l'API (rattachement par le NIR seul, dans tout le réseau, une salariée = une société de référence, ligne sans NIR exploitable non rattachée avec sa cause, ligne sans nom ni NIR en anomalie). L'écran n'en montre que les effets (taux, liste, anomalies) ; il n'affiche aucun rattachement par prénom et nom.
- `rule-evp-link-nir-two-companies` (inferred, decision D-0020), `rule-evp-link-incomplete-read` (inferred, decision D-0021), `rule-evp-link-unknown-creche` (inferred, decision D-0022), `rule-evp-link-person-both-states` (inferred, backend, decision D-0023), `rule-evp-link-employee-not-read` (inferred, backend, decision D-0024) : définies par la demande à l'API ; effet à l'écran : un NIR porté par deux collaboratrices donne « NIR porté par plusieurs collaboratrices PayFit » ; une lecture PayFit incomplète, ou une collaboratrice trouvée en direct mais pas encore lue, donne « NIR non vérifié… » ; un établissement inconnu ne produit aucune anomalie ; une personne dont un créneau a un NIR connu et un autre n'en a pas figure dans la liste (« NIR absent dans Aqoona », crèche du créneau sans NIR) tout en étant comptée rattachée dans le tableau.
- `rule-evp-payfit-scope-every-read` (user) : chaque lecture de PayFit fait une introspection de chaque clé et signale, dans les anomalies de PayFit, toute clé sans la portée `collaborators:social-security:read`, pour la société concernée. Remplace `rule-evp-payfit-scope-missing-visible` pour la couverture (D-0019).
- `rule-evp-payfit-scope-introspection-failed` (user) : une introspection en échec est signalée aussi (« Introspection de la clé PayFit en échec »), sans rien dire de la portée.
- `rule-evp-payfit-scope-no-nir-read` (user, D-0018) : la lecture PayFit ne lit toujours aucun NIR ; rien ne s'affiche de plus que les anomalies.
- `rule-evp-payfit-scope-no-failure` (inferred) : ces anomalies ne rendent la lecture ni `PARTIAL` ni `FAILED` ; l'état et le message de fin de lecture de la page sont inchangés.
- `rule-evp-company-named-in-anomalies` (user) : les anomalies de portée (« Rapprochement par NIR indisponible », « Portée PayFit manquante », « Introspection de la clé PayFit en échec ») désignent la société par son nom et son SIRET : « <Nom> (SIRET <14 chiffres>) » ; l'écran affiche le texte de l'API sans le recomposer. Le masquage défensif ne touche pas un SIRET de 14 chiffres.
- `rule-evp-nir-key-never-shown` (user), `rule-evp-sources-nir-redaction-studio`, `rule-evp-secrets-never-exposed` : inchangées ; la nouvelle section et la liste n'affichent aucune valeur d'apparence NIR.
- Inchangées : `rule-evp-sources-guard`, `rule-evp-sources-readonly`, `rule-evp-sources-partial-failure`, `rule-evp-sources-run-polling`, `rule-evp-aqoona-mask`, `rule-evp-aqoona-nir-transient-key`, `rule-evp-aqoona-nir-never-stored`, et toutes celles des plans précédents non citées ici.

## Tests
Navigateur (Playwright, `acceptance/e2e/`, écrits par QA, sélection par rôle et nom accessible, pilote `fake`, NIR fictifs dont un à clé fausse) et `pnpm --dir studio type:check` / `build` pour la fabrication. Chaque test cite sa règle.
- Tableau des personnes : titre, nom accessible, colonnes, cellule « 75,0 % (3) », société sans SIRET, « Sans société identifiée » en dernier, pied et note (`rule-evp-matching-rates-people`, `-percent`, `-no-company`) ; plus aucune colonne « par prénom et nom » ni « Créneaux lus ».
- Liste : une ligne par personne et par cause, les cinq libellés de cause, « Personne non nommée », « Crèche inconnue » (liste vide), une personne à la fois rattachée dans le tableau et dans la liste (`rule-evp-link-person-both-states`), pagination 10 / 25 / 50 et « 1–25 sur N », changer de page ne relit pas les taux (`rule-evp-unlinked-list`, `-grain`, `-paging`, `-all-causes-visible`).
- États : jamais lue, créneaux d'avant la v5, aucune personne, liste vide ; échec d'une section avec « Réessayer » sans masquer l'autre ni les cartes.
- Après une lecture lancée depuis l'écran : les deux sections et les cartes sont relues, la liste revient à la page 1.
- Anomalies : « Portée PayFit manquante », « Introspection de la clé PayFit en échec », « Rapprochement par NIR indisponible » avec « <Nom> (SIRET …) », « Planning non rattaché » avec cause et crèche, « Ligne Aqoona sans nom ni NIR » (`rule-evp-payfit-scope-every-read`, `-introspection-failed`, `rule-evp-company-named-in-anomalies`, `rule-evp-link-unusable-nir`, `rule-evp-link-no-identity`).
- Droits : RH et superadmin voient les deux sections ; directrice, RO, administratrice : « Accès refusé », aucun appel aux deux routes (`rule-evp-matching-rates-same-rights`, `rule-evp-unlinked-list-same-rights`).
- Aucune valeur d'apparence NIR dans les deux sections, la liste et les anomalies ; un SIRET de 14 chiffres reste lisible (`rule-evp-unlinked-list-no-nir`, `rule-evp-sources-nir-redaction-studio`).
- Point 5 de la demande (test instable de la v4) : test d'acceptation de l'API réécrit par QA, aucun test de navigateur.

## Accès
Inchangé : RH et superadmin (capacité `sources:read`) voient l'écran, les deux sections et la liste ; directrice, RO, administratrice : « Accès refusé », sans appel aux routes de taux ni de liste. Pas de distinction RH / superadmin.

## Hypothèses
- Les deux sections s'ajoutent à la page Sources plutôt qu'à un nouvel écran : la demande dit « sur l'écran Sources » et « mêmes droits ». Aucune nouvelle route studio, aucune entrée de menu.
- La liste est une section lisible en permanence, pas un panneau modal ; la quinzaine de salariées sans NIR citée par la demande tient dans une page de 25, mais la pagination couvre le réseau entier.
- Les libellés de titre, de colonnes et de notes ci-dessus sont proposés faute de `70-ecrans.md` pour ces éléments ; les tests de navigateur les sélectionnent par rôle et nom accessible.
- Une personne non reliée lue dans les crèches de deux sociétés compte dans les deux lignes du tableau et n'apparaît qu'une fois dans la liste, avec ses deux crèches.
- La colonne « Crèche » affiche le nom du référentiel, ou l'établissement tel que lu dans Aqoona quand il est inconnu du référentiel (fourni par l'API) ; « Crèche inconnue » ne sert que si l'API envoie une liste vide.
- Aucun seuil, alerte, export, filtre ni tri côté écran sur la liste ; aucun lien vers la correction : la demande ne les prévoit pas.
- Hors demande, non préparés : saisie des absences de volantes par la directrice d'accueil, droits de rattachement des volantes, contrôle des heures planifiées contre les heures du contrat PayFit.
- Le point 5 de la demande (test instable de la v4) est un test de QA : aucun écran ni aucune route n'est concerné.
- Les tests de navigateur posent des NIR fictifs (dont un à clé fausse) dans les fixtures et vérifient qu'aucune valeur d'apparence NIR n'est lisible dans les deux sections ni dans les anomalies.
