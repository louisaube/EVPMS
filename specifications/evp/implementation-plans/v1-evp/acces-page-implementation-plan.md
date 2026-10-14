# Écran Administration / Accès (`/acces`) : plan de réalisation

Objet : gérer les accès à EVP : rechercher, filtrer, créer ou modifier un accès (adresse Workspace, nom, rôle, statut, crèches), activer, désactiver ou retirer. Marine (RH) et Justine (administratrice) gèrent les RO ; Louis (superadmin) gère les RO et les directrices. Aucun rôle ne gère les comptes privilégiés ni son propre rôle depuis cet écran.

## Réutilisation
`usePagedList` (pagination serveur 10 / 25 / 50), `AdminList` (états de liste, « Réessayer »), `FormDialog` (dialogue création / modification, « Annuler » / « Enregistrer »), `PageHeader`, `useCall` (échecs, fin de session sur `401`), `notify` (succès) de `studio/src/app/shared/` ; modèle : `features/users/pages/UsersPage.tsx` et ses dialogues. Le tableau passe en cartes sous 767 px par le composant de mise en page commune, pas par une copie locale. Les crèches du formulaire viennent de `GET /creches` (déjà chargé par le hook de la mise en page si possible).

## Parcours
1. L'utilisateur ouvre « Accès ». Attente pendant `GET /access-accounts` et `GET /creches`.
2. Il recherche (nom ou adresse), filtre (rôle, statut) et parcourt la liste paginée.
3. « Nouvel accès » ouvre un dialogue : adresse Workspace, nom, rôle (parmi ceux que son rôle peut gérer), statut actif, crèches. « Enregistrer ».
4. « Modifier » sur une ligne ouvre le même dialogue pré-rempli (adresse en lecture seule).
5. « Retirer » (RO seulement) ouvre une confirmation : le compte est désactivé et ses affectations vidées, l'historique est conservé.
6. Succès : dialogue fermé, liste relue, notification. Échecs : dialogue ouvert, saisies conservées, message précis.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Accès des RO » (RH, administratrice) ou « Accès des RO et des directrices » (superadmin) (`h1`) | — | `capabilities` |
| Bouton de création | « Nouvel accès » | Ouvre le dialogue de création | — |
| Recherche | « Rechercher un accès » (nom ou adresse, 1 à 100 caractères) | Relit la liste après 300 ms sans frappe ; page 1 | `GET /access-accounts?search=` |
| Filtre rôle | « Rôle » (« Tous », « RO », et « Directrice » pour le superadmin) | — | `role` |
| Filtre statut | « Statut » (« Tous », « Actifs », « Désactivés ») | — | `active` |
| Tableau | colonnes « Nom », « Adresse e-mail », « Rôle », « Statut », « Crèches », « Actions » | Pagination serveur 10 / 25 / 50, 10 par défaut (`rule-foundation-list-pagination`) ; cartes sous 767 px | `GET /access-accounts?from=&size=` |
| Cellule « Statut » | « Actif » / « Désactivé » (texte + icône) | — | `active` |
| Cellule « Crèches » | une pastille par crèche (nom), « Aucune crèche » si vide ; « +N » au-delà de 3 avec infobulle | — | `creches` |
| Bouton « Modifier » | « Modifier l'accès de <nom> » | Ouvre le dialogue | — |
| Bouton « Retirer » | « Retirer l'accès de <nom> » | Visible pour un compte RO ; désactivé s'il est déjà désactivé et sans crèche | — |
| Dialogue de création / modification | Titre « Nouvel accès » / « Modifier l'accès » ; champs : « Adresse Workspace » (e-mail, obligatoire, doit se terminer par `@micro-stars.fr`, ≤ 254 caractères ; lecture seule en modification), « Nom » (1 à 120 caractères), « Rôle » (liste ; désactivée sur son propre compte avec l'aide « Vous ne pouvez pas modifier votre propre rôle. »), « Actif » (interrupteur, activé par défaut), « Crèches » (choix multiple de crèches vérifiées, au moins une si actif) ; boutons « Annuler » et « Enregistrer » | Envoi `POST /access-accounts` ou `PATCH /access-accounts/{id}` | `POST` / `PATCH /access-accounts` |
| Aide du champ crèches | « Un compte actif a au moins une crèche. Seules les crèches vérifiées par le tableau « Contacts des crèches » sont proposées. » | — | `GET /creches` (`verified`) |
| Aide directrice | « Une directrice doit correspondre au tableau source des crèches. » | Affichée si le rôle choisi est « Directrice » | — |
| Dialogue de retrait | « Retirer l'accès de <nom> ? » « Le compte sera désactivé et ses crèches retirées. Son historique est conservé. Cette action est tracée au journal. » ; « Annuler » / « Retirer l'accès » | Un seul envoi | `POST /access-accounts/{id}/remove` |
| Vide | « Aucun accès ne correspond à votre recherche. » / sans recherche « Aucun accès à gérer pour le moment. » | — | — |
| Avertissement | « Les comptes privilégiés (RH, administratrice, superadmin) ne se gèrent pas depuis cet écran. » | Note fixe sous le titre | — |

### Succès et échecs
| Cas | Message |
|---|---|
| Création | « Accès créé. » |
| Modification | « Accès modifié. » |
| Retrait | « Accès retiré. » |
| `409 access.email_already_exists` | « Cette adresse est déjà utilisée. » sous le champ e-mail |
| `422 access.invalid_domain` | « L'adresse doit appartenir au domaine micro-stars.fr. » |
| `422 access.creche_required` | « Un compte actif doit avoir au moins une crèche. » |
| `422 access.creche_not_verified` | « Une des crèches n'est pas vérifiée par le tableau source. » |
| `422 access.directrice_source_mismatch` | « Cette directrice ne correspond pas au tableau source des crèches. » |
| `403 access.privileged_account` | « Ce compte est privilégié : il ne se gère pas depuis cet écran. » |
| `403 access.role_not_manageable` | « Votre rôle ne permet pas de gérer ce type d'accès. » |
| `409 access.cannot_change_own_role` | « Vous ne pouvez pas modifier votre propre rôle. » |
| `400` | « Données invalides. Vérifiez les champs. » |
| autres | `rule-foundation-api-failure-handling` |

## Règles
- `rule-evp-access-admin` (user) : l'administration EVP gère comptes, rôles métier et crèches ; créer ou modifier un accès : adresse Workspace, nom, rôle autorisé, statut actif, crèches vérifiées.
- `rule-evp-access-who-manages` (user) : Marine (RH) et Justine (administratrice) gèrent les RO ; Louis (superadmin) gère les RO et les directrices.
- `rule-evp-access-active-needs-creche` (user) : un compte actif a au moins une crèche.
- `rule-evp-access-directrice-source` (user) : une directrice doit correspondre au tableau source.
- `rule-evp-access-remove-ro` (user) : retirer une RO désactive le compte et vide ses affectations, sans supprimer son historique.
- `rule-evp-access-no-self-role` (user) : impossible de modifier son propre rôle.
- `rule-evp-access-no-privileged` (user) : impossible de modifier un compte privilégié depuis cette gestion.
- `rule-evp-access-source-no-resurrect` (user) : le tableau source ne recrée pas silencieusement une RO retirée (aucun bouton de réactivation implicite ; réactiver passe par « Modifier » et un enregistrement explicite).
- `rule-evp-access-audited` (user) : chaque action est historisée ; le dialogue de retrait le rappelle.
- `rule-evp-access-domain` (user) : l'adresse est du domaine Workspace `micro-stars.fr`.
- `rule-evp-access-no-password` (user) : aucun champ de mot de passe n'existe.
- `rule-evp-access-list-scope` (inferred) : la liste ne contient que les accès gérables par l'appelant (RO, plus directrices pour le superadmin) ; les comptes privilégiés n'y figurent pas.
- `rule-evp-access-pagination` (inferred) : pagination serveur 10 / 25 / 50, 10 par défaut ; les crèches du formulaire sont chargées en entier.
- `rule-evp-access-guard` (inferred) : sans la capacité `access:manage:ro`, l'adresse affiche « Accès refusé » sans appel à l'API.

## Accès
RH, administratrice, superadmin. Directrice et RO : « Accès refusé ». Le choix « Directrice » (filtre, rôle du dialogue) n'existe que pour la capacité `access:manage:directrice` (superadmin).

## Hypothèses
- Les rôles choisissables sont RO (RH, administratrice, superadmin) et Directrice (superadmin) ; aucun rôle privilégié ne peut être attribué depuis cet écran.
- Retirer ne s'applique qu'aux RO (la demande ne définit que ce retrait) ; une directrice se désactive par l'interrupteur « Actif ».
- Une RO retirée reste listée (statut « Désactivé », « Aucune crèche ») ; réactiver exige une crèche.
- Le nom est de 1 à 120 caractères (borne inférée).
- Les écarts RO signalés par la lecture du tableau source s'affichent sur l'écran Sources, pas ici.
- « Crèches vérifiées » = crèches issues de la lecture du Google Sheets « Contacts des crèches ».
