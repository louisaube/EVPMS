# Écran Accueil / connexion (`/connexion`) : plan de réalisation

Objet : page publique qui dit si le service est prêt, explique pourquoi s'il ne l'est pas et propose la connexion Google Workspace lorsqu'il l'est. Aucune donnée RH n'est affichée ni appelée. Elle remplace l'écran de connexion par e-mail et mot de passe du socle (`LoginPage.tsx`).

## Parcours
1. Le visiteur ouvre `/connexion` (ou est redirigé depuis une page protégée avec `?redirection=`). Pendant la lecture de l'état du service : « Vérification de l'état du service… » (`role="status"`).
2. `GET /service-status` répond :
   - `ready` : carte « Le service est prêt » et bouton « Se connecter avec Google ».
   - `unavailable` : carte « Le service est momentanément indisponible » avec l'explication (texte français de l'API selon `reason`) et le bouton « Réessayer » ; le bouton de connexion n'est **pas** affiché.
   - Échec réseau ou `5xx` de la lecture elle-même : même carte d'indisponibilité avec « Impossible de joindre le service. Réessayez dans quelques instants. » et « Réessayer ».
3. Clic sur « Se connecter avec Google » : navigation pleine page vers `GET /google-sign-in/start?redirection=<chemin sûr>` ; l'API redirige vers Google (compte du domaine `micro-stars.fr`), puis Google vers `GET /google-sign-in/callback`.
4. Le callback pose le cookie de session (8 h) et redirige le navigateur vers l'origine du studio :
   - succès : `/` ou le chemin sûr demandé ;
   - refus : `/connexion?erreur=<code>` (voir tableau des messages) ; la page affiche l'alerte au-dessus du bouton.
5. Un utilisateur déjà connecté qui ouvre `/connexion` est redirigé vers la même destination sûre (`rule-foundation-login-already-connected`).
6. Retour après déconnexion ou fin de session : `?motif=session-expiree` ou `?motif=acces-retire` affiche une alerte d'information.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Surtitre | « EVP » | Marque, Fredoka | — |
| Titre | « Préparation et suivi des absences » (`h1`) | — | — |
| Pastille d'état | « Service prêt » ou « Service indisponible » (texte + icône, pas la couleur seule) | Mise à jour à chaque « Réessayer » | `GET /service-status` |
| Explication d'indisponibilité | Texte de l'API ; ex. « La connexion Google n'est pas encore configurée. » | Affichée seulement si `unavailable` | `GET /service-status` (`message`) |
| Bouton de connexion | « Se connecter avec Google » | Visible seulement si `ready` ; désactivé et « Redirection vers Google… » après le clic ; navigation `window.location.assign` | `GET /google-sign-in/start` |
| Bouton « Réessayer » | « Réessayer » | Relit l'état du service | `GET /service-status` |
| Alerte d'erreur de connexion | voir tableau | `role="alert"`, au-dessus du bouton, remplacée à la tentative suivante | paramètre `erreur` |
| Alerte d'information | « Votre session a expiré. Reconnectez-vous. » / « Votre accès a été retiré ou désactivé. Contactez la RH. » | `role="status"` | paramètre `motif` |
| Note d'information | « La connexion se fait avec votre compte Google Workspace micro-stars.fr. EVP ne demande aucun mot de passe et n'accède ni à votre messagerie, ni à votre agenda, ni à votre Drive. » | Texte fixe | — |
| Avertissement PayFit | « Les écritures dans PayFit sont désactivées. » | Texte fixe (la mise en page commune n'est pas rendue sur cette page publique) | — |

### Messages du paramètre `erreur`
| Code | Message |
|---|---|
| `domaine` | « Ce compte Google n'appartient pas au domaine micro-stars.fr. Choisissez votre compte professionnel. » |
| `non_autorise` | « Ce compte n'est pas autorisé à utiliser EVP. Demandez l'ouverture d'un accès à la RH. » (compte absent de la liste, inactif ou sans crèche : le même message, pour ne rien révéler) |
| `annule` | « La connexion a été annulée. » |
| `echec` ou valeur inconnue | « La connexion a échoué. Veuillez réessayer. » |

Aucun message technique, aucun détail Google n'est affiché.

## Règles
- `rule-evp-login-google-only` (user) : la connexion se fait uniquement par Google Workspace ; il n'y a ni champ de mot de passe, ni inscription, ni mot de passe oublié.
- `rule-evp-login-domain-not-enough` (user) : le domaine `micro-stars.fr` ne suffit jamais ; le compte doit aussi être actif, inscrit, avec un rôle et des crèches. Le refus est décidé par l'API ; l'écran affiche seulement le message correspondant.
- `rule-evp-login-service-status` (user) : l'écran montre l'état du service, explique l'indisponibilité et ne propose la connexion Google que si le service est prêt.
- `rule-evp-login-public-no-hr-data` (user) : la page est publique et n'affiche ni n'appelle aucune donnée RH.
- `rule-evp-login-single-denial` (inferred) : compte absent, inactif ou sans crèche donnent le même message `non_autorise`.
- `rule-evp-login-safe-redirect` (inferred) : la destination après connexion réutilise `safeRedirect` (`rule-foundation-login-redirect-home`) ; elle est transmise à l'API qui la valide aussi.
- `rule-evp-login-already-connected` (inferred) : un utilisateur connecté est redirigé hors de `/connexion`.
- `rule-evp-login-no-secret-in-studio` (inferred) : le studio ne manipule aucun jeton Google ; l'échange de code se fait côté API.

## Accès
Public. Un utilisateur connecté est redirigé. Aucun rôle n'est requis ; aucune donnée RH n'est exposée.

## Hypothèses
- Flux OAuth par redirection côté serveur (code d'autorisation) plutôt que bouton Google Identity Services : le studio n'embarque aucun identifiant client Google.
- Les causes de l'indisponibilité (`reason`) sont : configuration Google absente, base injoignable, maintenance ; le texte exact est rédigé par l'API.
- Une demande de connexion pour un compte Google valide du domaine mais non inscrit renvoie `non_autorise` : le compte n'est pas créé (aucune inscription en libre-service).
- Le titre de page est « Connexion · EVP ».
- La page ne montre pas de logo imposé ; l'identité « douce » est portée par le thème (couleurs, Fredoka).
