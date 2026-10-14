# Écran Sources (`/sources`) : plan de réalisation (v4)

Objet : l'écran Sources rend le rapprochement par NIR contrôlable. Il montre, pour chaque société, la part des créneaux Aqoona rattachés par NIR, rattachés par prénom et nom, et non rattachés, et il laisse lire dans les anomalies d'Aqoona les trois nouveaux signalements (portée PayFit manquante, clé de NIR fausse côté Aqoona, côté PayFit), sans jamais afficher un NIR.

Les plans de la v1 (`../v1-evp/sources-page-implementation-plan.md`), de la v2 et de la v3 (`../v3-evp-acces-contrats-siret/sources-page-implementation-plan.md`) restent la référence pour tout ce qui n'est pas dit ici. La demande à l'API est `sources-api-modification-request.md`. Les choix laissés ouverts sont dans `questions.yaml` ; ce plan applique les décisions du registre `../../arbitrages.yaml` pour cette version (D-0015 Q-EVP-15 A, D-0016 Q-EVP-16 A, D-0017 Q-EVP-17 A, D-0018 Q-EVP-14 A) et D-0019 (Q-EVP-18 A, par défaut).

## Parcours
Inchangé pour les cartes, l'actualisation, le suivi et le panneau d'anomalies. Compléments :
1. Sous les cartes de sources, une section « Rattachement des créneaux Aqoona » présente un tableau, une ligne par société. Elle se charge seule : tant qu'elle attend, un indicateur de chargement (`role="status"`) ; si sa requête échoue, un message d'erreur et « Réessayer » dans la section, sans masquer les cartes.
2. Trois états sans tableau, avec un texte (`role="status"`) :
   - Aqoona jamais lue : « Aqoona n'a pas encore été lue : les taux de rattachement apparaîtront après la première lecture. »
   - Lecture faite avant la v4, créneaux dont le mode de rattachement n'est pas encore connu : « Les taux seront disponibles après la prochaine lecture complète d'Aqoona. »
   - Aqoona lue mais aucun créneau dans la fenêtre : « Aucun créneau Aqoona dans la fenêtre lue. »
3. À la fin d'une lecture lancée depuis l'écran (ou suivie), la section est relue en même temps que les cartes ; elle reflète donc la lecture qui vient de se terminer. Une lecture d'une autre source ne change pas ses chiffres.
4. Le panneau d'anomalies d'Aqoona peut montrer, en plus des types des versions précédentes : « Clé de NIR Aqoona incorrecte », « Clé de NIR PayFit incorrecte », et « Rapprochement par NIR indisponible » avec, pour une portée manquante, un détail qui nomme la portée `collaborators:social-security:read`. Les libellés viennent de l'API ; l'écran n'en code aucun. Aucune de ces lignes ne contient de NIR : le sujet est un prénom et un nom (ou un SIRET), le détail est un texte.
5. Aucune action nouvelle : la section est en lecture seule (pas de bouton d'export, de correction ni de lien vers les créneaux).

## Éléments à l'écran
Éléments des versions précédentes conservés avec leurs libellés. Ajouts :

| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Section | titre de niveau 2 « Rattachement des créneaux Aqoona » | Placée sous les cartes ; contient le tableau ou un des textes d'état ; se relit après chaque lecture | `GET /sources/aqoona/matching-rates` |
| Tableau | nom accessible « Taux de rattachement des créneaux Aqoona par société » | Une ligne par élément de `items`, dans l'ordre de l'API (nom de société croissant, ligne « sans société » en dernier) | idem |
| En-tête de colonne | « Société » | Cellule d'en-tête de ligne : nom de la société, puis sur une seconde ligne « SIRET <14 chiffres> » (absent pour la ligne sans société) | `items[].name`, `items[].siret` |
| En-tête de colonne | « Créneaux lus » | Nombre de créneaux Aqoona stockés pour la société, format français | `items[].total` |
| En-tête de colonne | « Rattachés par NIR » | Cellule « 75,0 % (3) » : part puis effectif entre parenthèses, virgule décimale, une décimale | `items[].byNir` |
| En-tête de colonne | « Rattachés par prénom et nom » | Même format | `items[].byName` |
| En-tête de colonne | « Non rattachés » | Même format | `items[].unmatched` |
| Ligne sans société | « Sans société identifiée » (libellé envoyé par l'API) | Créneaux dont l'établissement ne désigne aucune crèche, dont la crèche n'a pas de société PayFit unique, ou dont la société n'est plus connue de PayFit ; mêmes colonnes, SIRET absent | `items[]` avec `companyId` nul |
| Pied de section | « Créneaux lus du <jj/mm/aaaa> au <jj/mm/aaaa>, d'après la lecture d'Aqoona du <jj/mm/aaaa> à <hh:mm>. » | Fenêtre et date de dernière lecture réussie, fournies par l'API | `windowFrom`, `windowTo`, `lastReadAt` |
| Note de lecture | « Un créneau est rattaché par NIR quand le NIR d'Aqoona désigne une collaboratrice PayFit de la société, par prénom et nom à défaut, et non rattaché si aucun des deux ne désigne une collaboratrice unique. » | Texte fixe sous le tableau | — |
| Type d'anomalie ajouté (Aqoona) | « Clé de NIR Aqoona incorrecte » | « Élément concerné » = prénom et nom ; « Détail » = nombre de créneaux et conduite (les noms sont utilisés) | `GET /sources/aqoona/anomalies` |
| Type d'anomalie ajouté (Aqoona) | « Clé de NIR PayFit incorrecte » | « Élément concerné » = prénom et nom de la collaboratrice ; « Détail » = SIRET de la société et conduite (ce NIR n'est pas utilisé) | idem |
| Détail ajouté de « Rapprochement par NIR indisponible » | texte de l'API, avec la portée manquante | « Élément concerné » = SIRET de la société | idem |

## Réalisation (studio)
- Réutilisation : `useLoad` + `useCall` (`shared/`) pour la lecture et la relecture (pas de hook de chargement nouveau), `EtatAttente` / `EtatErreur` (`shared/components/EtatsEcran`) pour l'attente et l'erreur avec « Réessayer », `formatNumber`, `formatDate`, `formatDateTime` (`shared/format`). Le pourcentage se met en forme dans le composant (`Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })`).
- Nouveau fichier : `studio/src/app/features/sources/components/AqoonaMatchingRates.tsx` (section, tableau, états) ; elle reçoit un compteur `reloadToken` placé dans les dépendances de `useLoad` (avec `keepData`).
- Fichiers existants modifiés : `SourcesPage.tsx` (monte la section sous les cartes ; incrémente `reloadToken` partout où elle appelle déjà `reloadSources()` à la fin d'une lecture) et un nouveau `studio/src/app/features/sources/components/redactNir.ts` qui reçoit `redactNir()` et `NIR_LIKE`, déplacés tels quels depuis `SourcesPage.tsx` (une seule définition pour la page et la section). Types de `@evpms/api-client` (à régénérer par `pnpm api-client:generate` après la modification de l'API).
- Le studio ne compte et ne calcule rien : effectifs et pourcentages sont ceux de l'API. Il ne fait que les mettre au format français (`Intl.NumberFormat('fr-FR')`, une décimale pour les pourcentages).
- Le tableau n'utilise pas la couleur seule pour porter un sens ; aucune barre ni seuil d'alerte n'est ajouté (la demande n'en prévoit pas).
- Le masquage défensif des NIR de la v3 (`redactNir()`, déplacé comme ci-dessus) s'applique aussi au nom de société, au libellé de la ligne sans société et aux textes d'état avant affichage ; un NIR à clé fausse a la même apparence qu'un NIR valide et est donc masqué de la même façon.
- Navigation clavier et lecteurs d'écran : vrai `<table>` avec `<caption>` (le nom accessible ci-dessus), `scope="col"` et `scope="row"`.

## Règles
- `rule-evp-matching-rates-screen` (user) : l'écran Sources montre, pour chaque société, la part des créneaux Aqoona rattachés par NIR, rattachés par prénom et nom, et non rattachés.
- `rule-evp-matching-rates-same-rights` (user) : la section a les mêmes droits que l'écran Sources (capacité `sources:read` : RH et superadmin) ; un autre rôle voit « Accès refusé » et la route est refusée.
- `rule-evp-matching-rates-slots` (inferred) : la part se compte en créneaux stockés (un créneau = une ligne dédoublonnée de `aqoona_plannings`), pas en personnes ; le total d'une ligne est la somme de ses trois effectifs ; la somme des totaux des lignes vaut « Plannings lus » de la carte Aqoona (decision D-0015, après une lecture sans adresse en échec : les créneaux conservés d'une adresse en échec sont comptés dans le tableau mais pas dans les volumes) et la somme des « Rattachés par NIR » vaut « Rapprochés par NIR ».
- `rule-evp-matching-rates-three-parts` (inferred) : un créneau est dans une seule des trois colonnes : par NIR (le NIR d'Aqoona, de clé juste, désigne une collaboratrice unique de la société de la crèche), par prénom et nom (rattaché sans que le NIR y ait servi, y compris quand le NIR est absent, de clé fausse, ou sans correspondance), non rattaché (aucune collaboratrice unique, y compris « Rattachement par NIR ambigu »).
- `rule-evp-matching-rates-company` (inferred) : un créneau compte pour la société de sa crèche (société PayFit unique du SIRET de la crèche) ; seules les sociétés qui ont au moins un créneau sont listées.
- `rule-evp-matching-rates-no-company` (inferred, decision D-0015) : les créneaux sans société identifiée forment une dernière ligne « Sans société identifiée » pour que le tableau compte tous les créneaux lus.
- `rule-evp-matching-rates-unknown-mode` (inferred, backend, decision D-0016) : tant qu'un créneau stocké a un mode de rattachement inconnu, l'écran n'affiche aucun taux, même partiel, et dit « Les taux seront disponibles après la prochaine lecture complète d'Aqoona. » ; il ne montre pas de quatrième part.
- `rule-evp-matching-rates-percent` (inferred) : pourcentage arrondi à une décimale, calculé par l'API ; les trois pourcentages d'une ligne peuvent donc totaliser 99,9 % ou 100,1 % ; les effectifs sont exacts.
- `rule-evp-matching-rates-no-nir` (user, `rule-evp-aqoona-nir-never-stored` et `rule-evp-nir-key-never-shown`) : la section n'affiche que des noms de société, des SIRET et des effectifs.
- `rule-evp-nir-key-never-shown` (user) : un NIR dont la clé est fausse ne s'affiche nulle part (cartes, volumes, anomalies, messages d'erreur, tableau) ; l'anomalie dit « clé incorrecte » et nomme la personne, jamais la valeur.
- `rule-evp-nir-key-anomalies-visible` (inferred) : les anomalies « Clé de NIR Aqoona incorrecte » et « Clé de NIR PayFit incorrecte » sont lisibles dans le panneau d'anomalies d'Aqoona (decision D-0018) ; elles ne rendent la lecture ni `PARTIAL` ni `FAILED`.
- `rule-evp-payfit-scope-missing-visible` (user) : la portée manquante est signalée par l'anomalie « Rapprochement par NIR indisponible » pour la société concernée, lisible dans le panneau d'anomalies d'Aqoona (decision D-0019) ; l'écran ne montre pas l'état de la clé ni la clé elle-même (`rule-evp-secrets-never-exposed`).
- Inchangées : `rule-evp-aqoona-nir-never-stored`, `rule-evp-aqoona-nir-transient-key`, `rule-evp-sources-nir-redaction-studio`, `rule-evp-secrets-never-exposed`, `rule-evp-sources-guard`, `rule-evp-sources-readonly`, `rule-evp-sources-partial-failure`, `rule-evp-sources-run-polling`, `rule-evp-aqoona-mask`, et toutes celles des plans de la v1 à la v3 non citées ici.

## Accès
Inchangé : RH et superadmin (capacité `sources:read`) voient l'écran et la section ; directrice, RO, administratrice : « Accès refusé », sans appel à la nouvelle route. Pas de distinction RH / superadmin dans la section (la lecture manuelle de Sheets reste réservée au superadmin, comme avant).

## Hypothèses
- « Société » s'entend d'une société PayFit (un SIRET, une clé) ; un créneau est rattaché à la société par le SIRET de la crèche de son établissement, comme en v3.
- Le taux porte sur les créneaux stockés au moment de la requête (dernier état des lectures d'Aqoona, y compris les créneaux conservés d'une adresse en échec), pas sur un historique : aucune évolution dans le temps n'est montrée.
- Aucun seuil, alerte ni notification quand le taux de non-rattachés est élevé, aucune liste des salariées sans NIR dans Aqoona (les « Planning non rattaché » du panneau d'anomalies restent le seul détail nominatif) : la demande ne les prévoit pas.
- Un total général (« Ensemble ») n'est pas ajouté : la demande parle de « chaque société ».
- Les créneaux écrits avant la v4 n'ont pas de mode de rattachement ; ils sont remplacés à la prochaine lecture d'Aqoona qui les relit (voir le deuxième état de la section).
- Les tests de navigateur sélectionnent le tableau par son nom accessible et ses lignes par le nom de société ; ils posent des NIR fictifs (dont un à clé fausse) dans les fixtures et vérifient qu'aucune valeur d'apparence NIR n'est lisible à l'écran.
- Le format du champ `scope` de l'introspection PayFit (chaîne de portées séparées par des espaces, selon la norme d'introspection OAuth 2.0) est supposé ; voir `sources-api-modification-request.md`.
