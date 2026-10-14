# Écran Accueil / connexion (`/connexion`) : plan de réalisation (v3)

Objet : quand un compte Google déjà lié à un accès se présente avec une autre adresse, ou qu'un compte Google recréé se présente avec l'adresse d'un accès lié à l'ancien, la connexion est refusée et l'écran dit pourquoi et ce qu'il faut faire. Aucun autre élément de l'écran ne change.

Les plans de la v1 (`../v1-evp/connexion-page-implementation-plan.md`) et de la v2 (`../v2-evp-sources/connexion-page-implementation-plan.md`) restent la référence pour tout ce qui n'est pas dit ici. La demande à l'API est `google-sign-in-api-modification-request.md`.

## Parcours
Inchangé, avec ces compléments à l'étape 4 :
1. Le serveur refuse la connexion d'un accès admissible dont le compte Google ne correspond plus : il redirige vers `/connexion?erreur=adresse_modifiee` (même identifiant Google, autre adresse) ou `/connexion?erreur=compte_recree` (même adresse, autre identifiant Google).
2. L'écran affiche l'alerte correspondante au-dessus du bouton. Le bouton « Se connecter avec Google » reste disponible : la personne ne peut rien corriger elle-même, elle transmet la marche à suivre à la personne qui gère son accès, puis revient se reconnecter.
3. Après correction (adresse mise à jour, ou accès délié), la connexion suivante ouvre la session (`/` ou le chemin sûr).

## Éléments à l'écran
Éléments de la v1 et de la v2 conservés avec leurs libellés. Seul le tableau des messages de `erreur` change :

| Code | Cause côté API | Message |
|---|---|---|
| `domaine` | inchangé | inchangé |
| `non_autorise` | compte absent, inactif, retiré ou sans crèche (la liaison Google n'est plus une cause : voir les deux lignes suivantes) | « Ce compte n'est pas autorisé à utiliser EVP. Demandez l'ouverture d'un accès à la RH. » (inchangé) |
| `adresse_modifiee` | l'accès est lié à ce compte Google, mais l'adresse du compte Google n'est plus celle de l'accès | « L'adresse de votre compte Google n'est plus celle de votre accès EVP. Demandez à la personne qui gère les accès (la RH, l'administratrice ou, si vous êtes directrice, le superadmin) de mettre à jour l'adresse de votre accès, puis reconnectez-vous. » |
| `compte_recree` | l'adresse est celle d'un accès lié à un autre compte Google | « Votre compte Google n'est plus celui qui est lié à votre accès EVP : il a sans doute été recréé. Demandez à la personne qui gère les accès (la RH, l'administratrice ou, si vous êtes directrice, le superadmin) de délier votre accès de l'ancien compte Google depuis l'écran Accès, puis reconnectez-vous : votre compte actuel sera alors relié. » |
| `annule` | inchangé | inchangé |
| `echec` ou valeur inconnue | inchangé | « La connexion a échoué. Veuillez réessayer. » |

Les deux messages nouveaux sont rendus dans l'alerte `role="alert"` existante, comme les autres : un seul paragraphe, sans lien, sans bouton supplémentaire. Ils ne contiennent ni adresse, ni nom, ni identifiant Google.

## Règles
- `rule-evp-google-sub-email-mismatch` (user) : un compte Google lié qui se présente avec une adresse différente de celle de l'accès n'ouvre pas de session ; l'écran le dit (`erreur=adresse_modifiee`) et propose la marche à suivre : la personne qui gère l'accès met à jour l'adresse de l'accès.
- `rule-evp-google-sub-recreated` (user) : un compte Google recréé (même adresse, autre identifiant Google, décision D-0008) n'ouvre pas de session ; l'écran le dit (`erreur=compte_recree`) et propose la marche à suivre : la personne qui gère l'accès délie l'accès de son ancien compte Google depuis l'écran Accès, la connexion suivante le relie.
- `rule-evp-access-unlink-session` (inferred, decision D-0011) : une personne dont l'accès vient d'être délié a sa session ouverte coupée ; le `401` suivant la renvoie à cet écran de connexion comme à l'échéance de sa session (`rule-evp-session-8h`) et sa connexion suivante relie son compte Google actuel. Aucun message nouveau.
- `rule-evp-login-howto-who` (user) : la marche à suivre nomme les personnes qui gèrent l'accès par leur fonction (RH, administratrice, superadmin pour une directrice), jamais par un prénom ; les droits sont ceux de la gestion des accès (Marine et Justine pour les RO, Louis pour tous).
- `rule-evp-login-mismatch-admissible-only` (inferred) : ces deux messages ne sont affichés que pour un accès actif avec au moins une crèche ; tout autre cas affiche le message unique `non_autorise` (`rule-evp-login-single-denial`, désormais limitée à ces cas).
- `rule-evp-login-mismatch-no-address` (inferred) : l'écran n'affiche jamais l'adresse du compte Google ni celle de l'accès.
- `rule-evp-login-unknown-error` (inferred, inchangée) : toute valeur de `erreur` inconnue du studio affiche le message de `echec`.
- `rule-evp-google-sub-mismatch` (inferred, D-0008, révisée) : le refus reste sans effet sur la liaison ; seul le message change (ligne `compte_recree`).
- Inchangées : `rule-evp-login-google-only`, `rule-evp-login-domain-not-enough`, `rule-evp-login-service-status`, `rule-evp-login-public-no-hr-data`, `rule-evp-google-token-verified-server`, `rule-evp-google-flow-redirect`, `rule-evp-login-safe-redirect`, `rule-evp-login-already-connected`, `rule-evp-login-no-secret-in-studio`, `rule-evp-secrets-never-exposed`.

## Accès
Public, comme avant. Un utilisateur connecté est redirigé hors de `/connexion`.

## Hypothèses
- Le studio ne lit que `erreur` pour choisir le message ; il ne sait pas qui est la personne et ne peut donc pas lui nommer son gestionnaire précis : d'où la formule par fonctions.
- La personne qui reçoit le message `compte_recree` a prouvé qu'elle contrôle une adresse du domaine ; indiquer qu'un accès existe pour cette adresse lui est accepté, car la demande veut que l'écran dise la marche à suivre ; cette précision est limitée aux accès qui permettraient une connexion (voir `rule-evp-login-mismatch-admissible-only`).
- Pas de lien vers l'écran Accès dans le message : la personne bloquée ne peut pas s'y connecter, et l'écran est réservé à ceux qui gèrent les accès.
- Les valeurs de `erreur` sont en minuscules et sans accent, comme les existantes.
