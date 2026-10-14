# Demande à l'API : connexion Google, profil, capacités, configuration et gestion des accès

Écrans demandeurs : Accueil / connexion, Mise en page commune, Paramètres, Accès. Besoin : connaître l'état du service, se connecter par Google Workspace (sans mot de passe EVP), lire son profil et ses capacités à chaque chargement, lire la configuration visible, et gérer les accès (RO, directrices).

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /service-status` | public | anonymous, user, admin | aucune | `200 { status: "ready" \| "unavailable", reason: "google_not_configured" \| "database_unreachable" \| "maintenance" \| null, message: string(0..300) }` ; aucune donnée RH ; ne répond jamais `5xx` pour une indisponibilité de dépendance (répond `200 unavailable`) |
| `GET /google-sign-in/start` | public | anonymous, user, admin | query `redirection` : chemin relatif sûr, 1..300 caractères, commence par `/`, jamais `//` ni schéma (sinon ignoré, défaut `/`) | `302` vers Google (paramètre `hd=micro-stars.fr`, `state` signé et lié au navigateur, PKCE) ; `503 platform.service_unavailable` si Google n'est pas configuré |
| `GET /google-sign-in/callback` | public | anonymous, user, admin | query `code`, `state` (chaînes 1..2048), `error` facultatif | `302` vers l'origine du studio : succès `/` ou le chemin sûr, cookie de session posé (8 h) ; refus `/connexion?erreur=<domaine \| non_autorise \| annule \| echec>` ; jamais de corps JSON, jamais de détail Google dans l'adresse |
| `GET /profile` | `profile:read` | user, admin (tout compte EVP actif) | aucune | `200 { id, name(1..120), email, role: "DIRECTRICE" \| "RO" \| "RH" \| "ADMINISTRATRICE" \| "SUPERADMIN", active: true, scope: "ASSIGNED" \| "ALL", creches: [{ code, name }] (vide si `ALL`), capabilities: string[], sessionExpiresAt: date-heure ISO }` ; `403 access.account_inactive` (compte désactivé), `403 access.not_authorized` (plus inscrit, sans rôle ou sans crèche) ; droits relus en base à chaque appel |
| `GET /settings` | `settings:read` | user, admin | aucune | `200 { absenceTypes: [{ code, label, expectedPiece: string \| null, privatePiece: boolean, hrReview: boolean, payfitCode: string \| null }], limits: { sessionHours: 8, uploadLinkMinutes: 5, readLinkSeconds: 60, maxFileBytes: 10485760, formats: ["PDF","JPEG","PNG"] }, windows: { payfit: string, aqoona: string }, payfitWritesEnabled: false }` ; aucun secret, aucune clé, aucun identifiant de service |
| `GET /access-accounts` | `access:list` | user, admin (capacité `access:manage:ro`) | query `search` 1..100, `role` (`RO` ; `DIRECTRICE` réservé à `access:manage:directrice`), `active` booléen, `from` entier ≥ 0, `size` ∈ {10, 25, 50} (défaut 10) | `200 { items: [{ id, name, email, role, active, creches: [{ code, name }] }], total }` ; ne contient que les accès gérables par l'appelant (RO, plus directrices pour le superadmin) ; `403 access.role_not_manageable` pour un filtre de rôle non gérable |
| `POST /access-accounts` | `access:create` | user, admin (capacité `access:manage:ro`) | corps `{ email: e-mail ≤ 254 finissant par @micro-stars.fr, name: 1..120, role: "RO" \| "DIRECTRICE", active: boolean, crecheCodes: string[0..50] }` | `201` le compte ; `400 api.validation.incoming_failed` ; `403 access.role_not_manageable` ; `409 access.email_already_exists` ; `422 access.invalid_domain`, `422 access.creche_required`, `422 access.creche_not_verified`, `422 access.directrice_source_mismatch` |
| `PATCH /access-accounts/{id}` | `access:update` | user, admin (capacité `access:manage:ro`) | `id` UUID ; corps `{ name?, role?, active?, crecheCodes? }` (l'adresse ne change pas) | `200` le compte ; mêmes erreurs que la création ; `403 access.privileged_account` (RH, administratrice, superadmin) ; `409 access.cannot_change_own_role` ; `404 access.not_found` |
| `POST /access-accounts/{id}/remove` | `access:remove` | user, admin (capacité `access:manage:ro`) | `id` UUID, corps vide | `200` le compte désactivé, `creches: []`, historique conservé ; `403 access.privileged_account` ; `403 access.role_not_manageable` (une directrice ne se retire pas) ; `404 access.not_found` |
| `POST /auth/logout` | existant | user, admin | aucune | inchangé |
| `GET /auth/current-user` | existant | user, admin | aucune | inchangé |

## Règles
- `rule-evp-login-google-only` (user) : la connexion passe uniquement par Google Workspace ; `POST /auth/login` (e-mail et mot de passe du socle) n'est plus proposé par le studio et ne doit plus ouvrir de session pour un compte EVP.
- `rule-evp-login-domain-not-enough` (user) : à la fin du callback, le compte est refusé s'il n'est pas du domaine `micro-stars.fr`, ou s'il n'est pas actif, inscrit, avec un rôle et au moins une crèche ; aucun compte n'est créé par la connexion.
- `rule-evp-login-service-status` (user) : `GET /service-status` dit si le service est prêt et pourquoi il ne l'est pas ; public, sans donnée RH.
- `rule-evp-login-single-denial` (inferred) : compte absent, inactif ou sans crèche donnent la même redirection `erreur=non_autorise`.
- `rule-evp-login-safe-redirect` (inferred) : la destination est validée par l'API comme par le studio.
- `rule-evp-login-no-secret-in-studio` (inferred) : l'échange du code Google, les secrets et les jetons restent côté API ; Gmail, calendrier et Drive ne sont jamais demandés (portées `openid email profile` seulement).
- `rule-evp-session-8h` (user) : la session serveur dure 8 heures ; au-delà, `401`.
- `rule-evp-rights-rechecked` (user) : rôle, statut actif et crèches sont relus en base à chaque requête (pas de rôle mis en cache dans le cookie) ; un accès retiré met fin à la session à la requête suivante.
- `rule-evp-rights-db-enforced` (user) : les mêmes restrictions sont appliquées par le serveur et par la base (règles SQL limitant les lignes selon le rôle et les crèches, par exemple sécurité au niveau des lignes sur `absences`, pièces, notifications, clôtures).
- `rule-evp-capabilities-list` (inferred) : capacités exposées par `GET /profile` : `absences:create` (directrice, RO, RH, superadmin), `absences:decide` (RH seulement : valider, retourner, refuser, saisie effectuée), `export:run` (RH, superadmin), `journal:read` (RH, superadmin), `sources:read` (RH, superadmin), `sources:refresh:payfit` et `sources:refresh:aqoona` (RH, superadmin), `sources:refresh:sheets` (superadmin), `closures:attest` (directrice), `access:manage:ro` (RH, administratrice, superadmin), `access:manage:directrice` (superadmin), `notifications:read` (tous), `profile:read` et `settings:read` (tous). La liste exacte est une constante côté API, reprise dans le contrat sous forme d'énumération.
- `rule-evp-access-admin` (user) : créer ou modifier un accès : adresse Workspace, nom, rôle autorisé, statut actif, crèches vérifiées.
- `rule-evp-access-who-manages` (user) : RH et administratrice gèrent les RO ; le superadmin gère les RO et les directrices ; personne ne gère RH, administratrice ou superadmin depuis cette route.
- `rule-evp-access-active-needs-creche` (user) : un compte actif a au moins une crèche, vérifiée (issue de la lecture du Google Sheets).
- `rule-evp-access-directrice-source` (user) : une directrice doit correspondre au tableau source (nom de la directrice de la crèche).
- `rule-evp-access-remove-ro` (user) : retirer une RO désactive le compte, vide ses affectations et conserve son historique (aucune suppression de ligne).
- `rule-evp-access-no-self-role` (user) : refus de modifier son propre rôle.
- `rule-evp-access-no-privileged` (user) : refus de modifier un compte privilégié par ces routes.
- `rule-evp-access-source-no-resurrect` (user) : la lecture du tableau source ne recrée, ne réactive ni n'écrase une RO retirée ou un choix administré ; elle crée une anomalie (voir demande Sources).
- `rule-evp-access-audited` (user) : chaque création, modification et retrait écrit une entrée de journal (auteur, action, cible, résumé administratif sans valeur brute) dans la même transaction.
- `rule-evp-access-list-scope` (inferred) : la liste exclut les comptes privilégiés.
- `rule-evp-access-pagination` (inferred) : `size` ∈ {10, 25, 50}, `from` ≥ 0, borné au contrat.
- `rule-evp-settings-no-secret` (inferred) : aucune valeur secrète n'est lisible par `GET /settings`.
- `rule-evp-settings-payfit-disabled` (user) : `payfitWritesEnabled` vaut toujours `false` en v1 ; aucun code de l'API n'écrit dans PayFit.
- `rule-evp-no-store` (inferred) : toutes les réponses métier portent `Cache-Control: no-store`.

## Compatibilité
- Le socle est gelé (`api/src/features/{auth,users,…}`, `api/src/platform/**`) : les routes ci-dessus sont dans de nouvelles fonctionnalités (`access`, `profile`, `google-sign-in`, `settings`). `POST /auth/login` et `/users` du socle restent dans le contrat de référence ; leur retrait côté studio n'est pas un changement de contrat.
- Les cinq rôles métier ne correspondent pas aux deux rôles `user`/`admin` de la matrice (`permissions.yaml`) : l'API les porte par une table d'accès EVP et des gardes métier (régime `auth+custom`), le rôle du socle restant `user` (ou `admin` pour le superadmin). L'arbitrage de la matrice attendue relève de QA (dispute à ouvrir si la matrice ne peut pas l'exprimer).
- Ajouts de tables au schéma `base` : à confirmer par dispute (`data-contract.md` est en lecture seule) ; sinon un schéma `evp` dédié.
- Pas de rupture sur les opérations existantes.
