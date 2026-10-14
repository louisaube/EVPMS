# Demande à l'API : vérification serveur du jeton d'identité Google et identification par `sub`

Écran demandeur : Accueil / connexion (`/connexion`). Besoin : que la connexion Google repose sur un jeton d'identité vérifié par le serveur selon les règles de Google (signature, audience, émetteur, expiration, domaine hébergé, e-mail vérifié), que l'utilisateur soit identifié par `sub` et non par son adresse, et que tous les points d'accès à Google soient paramétrables pour que la recette les pointe vers des serveurs factices.

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /service-status` | public (inchangé) | anonymous, user, admin | aucune | inchangé. `reason = google_not_configured` si l'une des variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PUBLIC_ORIGIN` (ou `GOOGLE_REDIRECT_URI`) manque ; aucun appel sortant n'est fait par cette route |
| `GET /google-sign-in/start` | public (inchangé) | anonymous, user, admin | inchangé (`redirection` : chemin relatif sûr, 1..300) | inchangé : `302` vers `GOOGLE_AUTH_URL` avec `client_id`, `redirect_uri`, `scope=openid email profile`, `hd` = domaine autorisé, `state`, `nonce`, PKCE S256 ; `503 platform.service_unavailable` si non configuré |
| `GET /google-sign-in/callback` | public (inchangé) | anonymous, user, admin | inchangé (`code`, `state` 1..2048, `error` facultatif) | inchangé : `302` vers l'origine du studio, jamais de corps JSON. Succès : `/` ou le chemin sûr et cookie de session de 8 h. Refus : `/connexion?erreur=<domaine \| non_autorise \| annule \| echec>` (tableau des causes dans les règles) |

Aucune route nouvelle (decision D-0005, option A de Q-EVP-01 : redirection serveur avec code d'autorisation). `POST /google-sign-in/credential` n'existe pas (404) et la règle `rule-evp-google-csrf-double-submit` ne s'applique pas.

## Configuration (variables d'environnement, aucune valeur dans le dépôt)
| Variable | Rôle | Défaut |
|---|---|---|
| `GOOGLE_CLIENT_ID` | audience attendue (`aud`) et `client_id` | aucun |
| `GOOGLE_CLIENT_SECRET` | secret client pour l'échange du code | aucun |
| `GOOGLE_PUBLIC_ORIGIN` | origine publique de l'API ; l'adresse de retour est `<origine>/google-sign-in/callback` (`GOOGLE_REDIRECT_URI`, si présent, l'emporte) | aucun |
| `GOOGLE_ALLOWED_DOMAIN` | domaine autorisé, comparé à `hd` | `micro-stars.fr` |
| `GOOGLE_AUTH_URL` | point d'autorisation | `https://accounts.google.com/o/oauth2/v2/auth` |
| `GOOGLE_TOKEN_URL` | échange du code | `https://oauth2.googleapis.com/token` |
| `GOOGLE_CERTS_URL` | clés publiques JWK | `https://www.googleapis.com/oauth2/v3/certs` |

## Règles
- `rule-evp-google-token-verified-server` (user) : le serveur vérifie lui-même le jeton d'identité et ne fait jamais confiance au navigateur ; aucune session n'est ouverte sur un jeton non vérifié.
- `rule-evp-google-signature` (user) : la signature (RS256) est contrôlée contre les clés publiques de `GOOGLE_CERTS_URL`, choisies par `kid`.
- `rule-evp-google-certs-cache` (user) : les clés sont mises en cache selon l'en-tête `Cache-Control` (`max-age`) de la réponse ; sans `max-age` exploitable, pas de mise en cache au-delà de la requête (inferred pour ce repli).
- `rule-evp-google-certs-rotation` (inferred) : un `kid` inconnu du cache provoque une seule relecture des clés avant refus, pour suivre la rotation sans relecture à chaque connexion ; jamais plus d'une relecture forcée par minute.
- `rule-evp-google-certs-fail-closed` (inferred) : clés illisibles, absentes ou en échec → refus `echec`, jamais d'acceptation par défaut ; le cache expiré n'est pas réutilisé si la relecture échoue.
- `rule-evp-google-aud` (user) : `aud` est égal à `GOOGLE_CLIENT_ID`.
- `rule-evp-google-iss` (user) : `iss` est `accounts.google.com` ou `https://accounts.google.com`.
- `rule-evp-google-exp` (user) : `exp` non dépassé (tolérance d'horloge de 60 s (inferred)).
- `rule-evp-google-hd` (user) : `hd` est égal au domaine autorisé, contrôle fait par le code lui-même ; un jeton sans `hd` (compte Google personnel) est refusé comme un autre domaine.
- `rule-evp-google-email-verified` (user) : `email_verified` vaut vrai.
- `rule-evp-google-domain-configurable` (user) : le domaine autorisé vient de `GOOGLE_ALLOWED_DOMAIN`.
- `rule-evp-google-flow-redirect` (inferred, decision D-0005) : flux serveur par code d'autorisation ; `state`, `nonce` et vérificateur PKCE restent dans un cookie signé de 10 minutes ; le jeton d'identité est lu dans la réponse de `GOOGLE_TOKEN_URL`, puis vérifié comme ci-dessus (le contrôle de TLS ne remplace pas la vérification de signature) ; `nonce` du jeton égal à celui du cookie.
- `rule-evp-google-endpoints-configurable` (user) : les trois adresses de Google sont paramétrables pour pointer vers des serveurs factices ; les seules valeurs par défaut sont les adresses officielles.
- `rule-evp-google-sub-identity` (user) : l'utilisateur est identifié par `sub` ; l'adresse est un attribut qui peut changer.
- `rule-evp-google-sub-binding` (inferred) : la première connexion valide d'un compte inscrit mais non lié (recherche par adresse, insensible à la casse) enregistre son `sub` dans `evp_accounts.google_sub` (texte, unique, 1..255) ; ensuite seule la recherche par `sub` ouvre une session. La liaison et la création du compte se font dans une transaction ; deux connexions simultanées ne lient qu'un `sub`.
- `rule-evp-google-sub-mismatch` (inferred, decision D-0008) : un compte lié à un `sub` refuse tout autre `sub`, même avec la même adresse : `erreur=non_autorise`, liaison inchangée.
- `rule-evp-google-sub-email-change` (inferred) : un `sub` lié qui se présente avec une adresse différente de celle inscrite ouvre la session si le compte est actif et inscrit ; l'adresse administrée n'est pas modifiée par la connexion.
- `rule-evp-google-sub-unique` (inferred) : un `sub` ne lie jamais deux comptes (contrainte d'unicité) ; une violation donne `non_autorise`.
- `rule-evp-login-domain-not-enough` (user, inchangé) : le compte doit être actif, inscrit, avec un rôle et des crèches ; sinon aucun accès aux données métier.
- `rule-evp-login-single-denial` (inferred, inchangé) : compte absent, inactif ou sans crèche → le même `non_autorise`.
- `rule-evp-session-8h` (user, inchangé) : session serveur de 8 heures.
- `rule-evp-google-error-causes` (inferred) : correspondance des causes de refus avec le paramètre `erreur` :
  | Cause | `erreur` |
  |---|---|
  | `error` de Google (refus ou annulation par la personne) | `annule` |
  | `hd` absent ou différent du domaine autorisé | `domaine` |
  | compte absent, inactif, sans crèche, `sub` en conflit | `non_autorise` |
  | `state` ou `nonce` invalide, cookie de flux absent ou expiré, échange du code refusé, signature, `aud`, `iss`, `exp` invalides, `email_verified` faux, clés injoignables, délai dépassé (10 s) | `echec` |
- `rule-evp-secrets-never-exposed` (user) : ni `GOOGLE_CLIENT_SECRET`, ni code, ni jeton, ni `state` n'apparaissent dans les journaux, les adresses de redirection, les exports, les entrées du journal d'audit ou un message d'erreur.
- `rule-evp-google-scopes-minimal` (inferred, inchangé) : portées `openid email profile` seulement.
- `rule-evp-google-sign-in-audit` (inferred) : la liaison d'un `sub` est tracée dans le journal (auteur « Système », objet « Accès », résumé « Liaison Google enregistrée », sans le `sub`).

## Compatibilité
- Aucune opération nouvelle ni modifiée dans son contrat ; les trois routes gardent leur forme. Pas de rupture du contrat de référence.
- Ajout de la colonne `google_sub` à `base.evp_accounts` : table de la fonctionnalité EVP, hors `data-contract.md` ; à confirmer par `OPEN: contract data-contract` si QA considère que la colonne touche le schéma `base` contracté.
- Sans variables, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `GOOGLE_PUBLIC_ORIGIN` ne reçoivent plus de valeur de substitution hors production : `GET /service-status` répond `unavailable` / `google_not_configured` et `GET /google-sign-in/start` répond `503`. `api/.env.test` fournit les variables (serveurs factices) quand les tests ont besoin du flux.
- `GOOGLE_REDIRECT_URI` reste accepté pour ne pas casser `api/.env.test`.
