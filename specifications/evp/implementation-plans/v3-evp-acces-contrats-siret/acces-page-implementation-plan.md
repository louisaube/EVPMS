# Écran Administration / Accès (`/acces`) : plan de réalisation (v3)

Objet : donner à ceux qui gèrent les accès (RH et administratrice pour les RO, superadmin pour les RO et les directrices) les deux gestes qui débloquent une personne dont la connexion Google est refusée : mettre à jour l'adresse de son accès (l'adresse de son compte Google a changé), ou délier son accès de son ancien compte Google (le compte a été recréé). La liste montre si un accès est lié à un compte Google.

Le plan de la v1 (`../v1-evp/acces-page-implementation-plan.md`) reste la référence pour tout ce qui n'est pas dit ici (garde, liste, filtres, pagination, création, retrait, réutilisation de `usePagedList`, `AdminList`, `FormDialog`). La demande à l'API est `acces-api-modification-request.md`.

## Parcours
Inchangé, avec ces compléments :
1. Une personne ne peut plus se connecter : l'écran de connexion lui a dit de demander à la personne qui gère les accès (`connexion-page-implementation-plan.md`).
2. **Adresse changée** : le gestionnaire ouvre « Accès », cherche la personne, choisit « Modifier l'accès de <nom> », remplace l'adresse dans « Adresse Workspace », « Enregistrer ». Succès « Accès modifié. » ; la personne se reconnecte avec sa nouvelle adresse et retrouve son accès, ses crèches et sa liaison Google.
3. **Compte recréé** : le gestionnaire repère l'accès (colonne « Compte Google » : « Lié »), choisit « Délier le compte Google de <nom> », lit la confirmation et valide. Succès « Compte Google délié. » ; la colonne passe à « Non lié ». À sa prochaine connexion, la personne est reliée à son nouveau compte Google.
4. Échecs : dialogue ouvert, saisies conservées (modification) ou message d'erreur dans le dialogue (déliement).

## Éléments à l'écran
Éléments de la v1 conservés avec leurs libellés. Changements et ajouts :

| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Colonne ajoutée | « Compte Google » (entre « Statut » et « Crèches ») ; cellule « Lié » ou « Non lié » (texte + icône, pas la couleur seule) ; sur les cartes (moins de 768 px), ligne « Compte Google : Lié » | Aucune valeur d'identifiant Google n'est affichée | `googleLinked` de `GET /access-accounts` |
| Champ adresse du dialogue de modification | « Adresse Workspace » (modifiable en modification comme en création : e-mail obligatoire, finit par `@micro-stars.fr`, ≤ 254 caractères) | Pré-rempli avec l'adresse actuelle ; n'envoie `email` que si la valeur a changé | `PATCH /access-accounts/{id}` |
| Aide du champ en modification | « Modifiez l'adresse si l'adresse du compte Google de la personne a changé. Son accès et sa liaison Google sont conservés. » | Texte d'aide sous le champ, en modification seulement | — |
| Bouton « Délier » | « Délier le compte Google de <nom> » | Dans la colonne « Actions », à côté de « Modifier » et « Retirer » ; visible pour un accès RO ou directrice que l'appelant peut gérer ; désactivé (avec l'infobulle « Cet accès n'est lié à aucun compte Google. ») si « Non lié » | — |
| Dialogue de déliement | Titre « Délier le compte Google de <nom> ? » ; texte « L'accès ne sera plus relié à son compte Google actuel. À sa prochaine connexion avec l'adresse de l'accès, le compte Google utilisé sera relié à la place. À utiliser quand la personne a recréé son compte Google. Les sessions déjà ouvertes de cette personne sont coupées : elle devra se reconnecter. Cette action est tracée au journal. » ; boutons « Annuler » et « Délier le compte Google » | Un seul envoi (bouton désactivé pendant l'appel) ; fermé au succès, liste relue | `POST /access-accounts/{id}/unlink-google` |

### Succès et échecs ajoutés
| Cas | Message |
|---|---|
| Adresse modifiée | « Accès modifié. » (inchangé) |
| Déliement | « Compte Google délié. » |
| `409 access.email_already_exists` (en modification) | « Cette adresse est déjà utilisée. » sous le champ « Adresse Workspace » (message de la v1) |
| `422 access.invalid_domain` (en modification) | « L'adresse doit appartenir au domaine micro-stars.fr. » (message de la v1) |
| `409 access.google_not_linked` | « Cet accès n'est lié à aucun compte Google. » ; liste relue (la colonne passe à « Non lié ») |
| `403 access.privileged_account` | « Ce compte est privilégié : il ne se gère pas depuis cet écran. » (message de la v1) |
| `403 access.role_not_manageable` | « Votre rôle ne permet pas de gérer ce type d'accès. » (message de la v1) |
| `404 access.not_found` | « Cet accès n'existe plus. » ; liste relue |
| autres | `rule-foundation-api-failure-handling` |

## Règles
- `rule-evp-access-address-edit` (user) : le gestionnaire met à jour l'adresse de l'accès lorsque l'adresse du compte Google de la personne a changé ; le champ « Adresse Workspace » est modifiable en modification.
- `rule-evp-access-google-unlink` (user) : le gestionnaire délie l'accès de son ancien compte Google depuis l'écran Accès quand le compte Google a été recréé (décision D-0008).
- `rule-evp-access-google-rebind` (user) : la connexion suivante relie le nouveau compte ; le dialogue le dit.
- `rule-evp-access-unlink-who` (user) : « Délier » et l'adresse modifiable ne sont offerts qu'à ceux qui gèrent l'accès : RH et administratrice pour une RO, superadmin pour une RO ou une directrice. Le bouton suit la capacité `access:manage:ro` et, pour une directrice, `access:manage:directrice` (jamais le nom du rôle).
- `rule-evp-access-google-linked-visible` (inferred) : la colonne « Compte Google » lit `googleLinked` ; le studio n'affiche aucun identifiant Google.
- `rule-evp-access-unlink-needs-link` (inferred) : « Délier » est désactivé pour un accès « Non lié ».
- `rule-evp-access-unlink-audited` (inferred) : le dialogue rappelle que l'action est tracée au journal (`rule-evp-access-audited`, user).
- `rule-evp-access-unlink-session` (inferred, decision D-0011) : le dialogue indique que les sessions déjà ouvertes de la personne sont coupées au déliement. Le studio ne fait rien de plus : la personne coupée est renvoyée à la connexion par le `401` comme à l'échéance de sa session (`rule-evp-session-8h`).
- `rule-evp-access-privileged-google-fix` (inferred, decision D-0012) : l'écran ne propose ni modification d'adresse ni déliement pour un compte privilégié ; ces comptes n'y figurent pas (note existante conservée) et leur déblocage se fait hors application.
- Inchangées : `rule-evp-access-admin`, `rule-evp-access-who-manages`, `rule-evp-access-active-needs-creche`, `rule-evp-access-directrice-source`, `rule-evp-access-remove-ro`, `rule-evp-access-no-self-role`, `rule-evp-access-no-privileged`, `rule-evp-access-source-no-resurrect`, `rule-evp-access-audited`, `rule-evp-access-domain`, `rule-evp-access-no-password`, `rule-evp-access-list-scope`, `rule-evp-access-pagination`, `rule-evp-access-guard`.

## Accès
Inchangé : RH, administratrice, superadmin (capacité `access:manage:ro`) ; directrice et RO voient « Accès refusé » sans appel. « Directrice » (filtre, rôle, déliement d'une directrice) reste réservé à la capacité `access:manage:directrice` (superadmin).

## Hypothèses
- L'adresse devient modifiable pour tous les accès gérables, liés ou non : la demande ne vise que l'accès lié, mais interdire la modification d'un accès non lié n'apporterait rien (corriger une faute de frappe d'adresse est le même geste).
- « Délier » est proposé sur la ligne même d'un accès « Désactivé » : une personne retirée qui revient doit pouvoir être déliée avant d'être réactivée par « Modifier ».
- Les libellés « Compte Google », « Lié », « Non lié », « Délier le compte Google de <nom> » sont choisis ici (la demande ne les fixe pas) ; les tests de navigateur sélectionnent par rôle et libellé, ils suivent ce plan.
- Le gestionnaire apprend la nouvelle adresse de la personne par elle-même ; l'écran ne la lui montre pas et ne cherche pas à la deviner.
- Les comptes privilégiés restent hors de l'écran (decision D-0012) ; le superadmin ne peut pas se débloquer lui-même depuis l'application.
- Le gestionnaire qui délie son propre accès n'existe pas : les gestionnaires sont des comptes privilégiés, absents de la liste.
