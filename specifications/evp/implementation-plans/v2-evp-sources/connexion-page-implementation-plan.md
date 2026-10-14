# Écran Accueil / connexion (`/connexion`) : plan de réalisation (v2)

Objet : page publique qui dit si le service est prêt, explique pourquoi s'il ne l'est pas et propose la connexion Google Workspace lorsqu'il l'est. Aucune donnée RH n'est affichée ni appelée. En v2 l'écran ne change presque pas : la vérification du jeton d'identité est entièrement côté API (`google-sign-in-api-modification-request.md`) ; l'écran gagne des messages d'erreur plus précis sur le même jeu de codes et une précision sur le contenu de la note d'information.

Le plan de la v1 (`../v1-evp/connexion-page-implementation-plan.md`) reste la référence pour tout ce qui n'est pas dit ici.

## Parcours
Inchangé par rapport à la v1 (option A de Q-EVP-01, decision D-0005) :
1. Ouverture de `/connexion` (éventuellement `?redirection=`) ; « Vérification de l'état du service… » pendant `GET /service-status`.
2. `ready` : carte « Le service est prêt » et « Se connecter avec Google » ; `unavailable` : carte d'indisponibilité, explication, « Réessayer », pas de bouton de connexion ; échec réseau ou `5xx` de la lecture : « Impossible de joindre le service. Réessayez dans quelques instants. ».
3. Clic sur « Se connecter avec Google » : navigation pleine page vers `GET /google-sign-in/start?redirection=<chemin sûr>` ; Google, puis `GET /google-sign-in/callback` ; le serveur vérifie le jeton d'identité (signature, audience, émetteur, expiration, domaine, e-mail vérifié), identifie l'utilisateur par `sub`, pose la session de 8 heures et redirige.
4. Succès : `/` ou le chemin sûr. Refus : `/connexion?erreur=<code>` avec l'alerte au-dessus du bouton.
5. Utilisateur déjà connecté : redirigé hors de `/connexion`.
6. `?motif=session-expiree` ou `?motif=acces-retire` : alerte d'information.

Le bouton Google Identity Services en POST (option B de Q-EVP-01) n'est pas retenu (decision D-0005) : le jeton ne transite jamais par le studio.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Surtitre | « EVP » | Marque | — |
| Titre | « Préparation et suivi des absences » (`h1`) | — | — |
| Pastille d'état | « Service prêt » ou « Service indisponible » (texte + icône) | Mise à jour à chaque « Réessayer » | `GET /service-status` |
| Explication d'indisponibilité | Texte de l'API, affiché tel quel ; pour `google_not_configured` : « La connexion avec Google n'est pas encore configurée. Contactez l'administrateur. » (message déjà renvoyé par `GET /service-status` en v1, non modifié) | Affichée seulement si `unavailable` | `GET /service-status` (`message`) |
| Bouton de connexion | « Se connecter avec Google » | Visible seulement si `ready` ; après le clic désactivé avec « Redirection vers Google… » ; `window.location.assign` | `GET /google-sign-in/start` |
| Bouton « Réessayer » | « Réessayer » | Relit l'état du service | `GET /service-status` |
| Alerte d'erreur de connexion | voir tableau | `role="alert"`, au-dessus du bouton, remplacée à la tentative suivante | paramètre `erreur` |
| Alerte d'information | « Votre session a expiré. Reconnectez-vous. » / « Votre accès a été retiré ou désactivé. Contactez la RH. » | `role="status"` | paramètre `motif` |
| Note d'information | « La connexion se fait avec votre compte Google Workspace micro-stars.fr. EVP ne demande aucun mot de passe et n'accède ni à votre messagerie, ni à votre agenda, ni à votre Drive. » | Texte fixe, inchangé | — |
| Avertissement PayFit | « Les écritures dans PayFit sont désactivées. » | Texte fixe, inchangé | — |

### Messages du paramètre `erreur`
| Code | Cause côté API | Message |
|---|---|---|
| `domaine` | jeton sans `hd` ou `hd` différent du domaine autorisé | « Ce compte Google n'appartient pas au domaine micro-stars.fr. Choisissez votre compte professionnel. » |
| `non_autorise` | compte absent, inactif, sans crèche, ou lié à un autre identifiant Google | « Ce compte n'est pas autorisé à utiliser EVP. Demandez l'ouverture d'un accès à la RH. » (le même message pour toutes ces causes, pour ne rien révéler) |
| `annule` | la personne a refusé ou fermé la fenêtre Google | « La connexion a été annulée. » |
| `echec` ou valeur inconnue | signature, audience, émetteur, expiration, `state`, `nonce` ou e-mail non vérifié invalides ; clés Google injoignables ; délai dépassé | « La connexion a échoué. Veuillez réessayer. » |

Aucun message technique, aucun détail Google, aucun jeton n'est affiché ; le paramètre `erreur` est le seul élément de l'adresse qui décrit l'échec.

## Règles
- `rule-evp-login-google-only` (user) : la connexion se fait uniquement par Google Workspace ; ni mot de passe, ni inscription, ni « mot de passe oublié ».
- `rule-evp-login-domain-not-enough` (user) : le domaine ne suffit jamais ; compte actif, inscrit, avec un rôle et des crèches, sinon aucun accès aux données métier. Le refus est décidé par l'API.
- `rule-evp-login-service-status` (user) : l'écran montre l'état du service, explique l'indisponibilité et ne propose la connexion que si le service est prêt.
- `rule-evp-login-public-no-hr-data` (user) : page publique, aucune donnée RH affichée ni appelée.
- `rule-evp-google-token-verified-server` (user) : le studio ne reçoit ni ne transmet aucun jeton d'identité en option A ; la vérification est faite par le serveur.
- `rule-evp-google-flow-redirect` (inferred, decision D-0005) : le bouton lance une navigation pleine page vers l'API, qui conduit le flux.
- `rule-evp-google-sub-mismatch` (inferred, decision D-0008) : un identifiant Google différent de celui lié au compte affiche le message `non_autorise`, sans autre indication.
- `rule-evp-login-single-denial` (inferred) : compte absent, inactif, sans crèche ou lié à un autre identifiant : le même message `non_autorise`.
- `rule-evp-login-safe-redirect` (inferred) : la destination réutilise `safeRedirect` et est validée aussi par l'API.
- `rule-evp-login-already-connected` (inferred) : un utilisateur connecté est redirigé hors de `/connexion`.
- `rule-evp-login-no-secret-in-studio` (inferred) : le studio ne contient aucun identifiant, secret ni jeton Google (option A).
- `rule-evp-secrets-never-exposed` (user) : aucun jeton, code ou `state` n'apparaît dans l'adresse affichée ou dans l'interface.

## Accès
Public. Un utilisateur connecté est redirigé. Aucune donnée RH exposée.

## Hypothèses
- L'option A de Q-EVP-01 (redirection serveur, déjà en place) est celle choisie par le propriétaire (decision D-0005) : le texte « Le navigateur obtient un jeton d'identité Google ; le serveur le vérifie » est lu comme « le serveur reçoit le jeton de Google et le vérifie » ; l'option B n'est pas retenue.
- Aucun libellé de l'écran ne change ; seuls les motifs de refus classés sous `echec` et `domaine` sont précisés.
- Le message pour un `hd` absent (compte Google personnel) est celui du domaine, car la cause pour la personne est la même.
- L'état « Service indisponible / `google_not_configured` » apparaît désormais aussi hors production quand les variables Google manquent (plus de valeurs de substitution).
- Le titre de page est « Connexion · EVP » (inchangé).
