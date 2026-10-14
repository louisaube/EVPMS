# Demande à l'API : un compte Google lié ne se connecte plus avec une autre adresse

Écran demandeur : Connexion (`/connexion`). Besoin : que la connexion soit impossible quand le compte Google présenté n'est plus celui de l'accès, que l'écran sache laquelle des deux situations se présente (adresse changée, ou compte Google recréé) pour proposer la marche à suivre, et que rien d'autre ne change dans le flux.

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /google-sign-in/callback` | public (inchangé) | anonymous, user, admin | inchangée (`code`, `state` 1..2048, `error` facultatif) | `302` uniquement, jamais de corps JSON. Succès inchangé. Refus : `/connexion?erreur=<domaine \| non_autorise \| annule \| echec \| adresse_modifiee \| compte_recree>` ; les deux dernières valeurs sont nouvelles |
| `GET /google-sign-in/start` | public (inchangé) | anonymous, user, admin | inchangée | inchangée |
| `GET /service-status` | public (inchangé) | anonymous, user, admin | aucune | inchangée |

Aucune route nouvelle. Les valeurs de `erreur` ne figurent pas dans le document OpenAPI (redirections `302` sans schéma de corps) : le contrat de référence ne change pas.

## Décision de la connexion (après vérification du jeton, inchangée : signature, `aud`, `iss`, `exp`, `nonce`, `email_verified`, `hd`)
Un compte est dit « admissible » s'il est inscrit, actif, non retiré, avec un rôle et au moins une crèche (`rule-evp-login-domain-not-enough`, inchangée).

| Cas | Compte trouvé | Résultat |
|---|---|---|
| 1 | par `sub`, adresse du jeton = adresse inscrite (sans tenir compte de la casse), admissible | session de 8 h (inchangé) |
| 2 | par `sub`, adresse du jeton ≠ adresse inscrite, admissible | aucune session ; `erreur=adresse_modifiee` ; rien n'est modifié |
| 3 | par `sub`, compte non admissible (quelle que soit l'adresse) | `erreur=non_autorise` |
| 4 | `sub` inconnu, adresse inscrite, compte non lié, admissible | liaison du `sub` puis session (inchangé, `rule-evp-google-sub-binding`) |
| 5 | `sub` inconnu, adresse inscrite, compte déjà lié à un autre `sub`, admissible | aucune session ; `erreur=compte_recree` ; liaison inchangée |
| 6 | `sub` inconnu, adresse inscrite, compte non admissible | `erreur=non_autorise` ; aucune liaison |
| 7 | `sub` inconnu, adresse inconnue | `erreur=non_autorise` (inchangé) |

## Règles
- `rule-evp-google-sub-email-mismatch` (user) : un compte Google déjà lié à un accès qui se présente avec une adresse différente de celle inscrite n'ouvre plus de session ; la connexion est refusée avec `erreur=adresse_modifiee` (cas 2). Elle remplace `rule-evp-google-sub-email-change` (v2), qui ouvrait la session.
- `rule-evp-google-sub-recreated` (user) : un accès déjà lié à un `sub` refuse un autre `sub` présentant la même adresse (décision D-0008) ; le refus porte désormais `erreur=compte_recree` au lieu de `non_autorise` (cas 5). La liaison n'est pas modifiée par la connexion ; elle ne change que par l'action « délier » de l'écran Accès (`acces-api-modification-request.md`), après quoi la connexion suivante relie le nouveau `sub` (cas 4). `rule-evp-google-sub-mismatch` (D-0008) reste vraie pour le refus et l'absence de modification.
- `rule-evp-google-sub-address-fix` (user) : après la mise à jour de l'adresse de l'accès par la personne qui le gère, la connexion du même `sub` avec la nouvelle adresse ouvre la session (cas 1), la liaison est conservée.
- `rule-evp-login-mismatch-admissible-only` (inferred) : les deux causes nouvelles ne sont rendues que pour un compte admissible ; un compte absent, inactif, retiré ou sans crèche garde le refus unique `non_autorise` (`rule-evp-login-single-denial`, qui ne s'applique plus qu'à ces cas). L'écran ne révèle donc rien d'un accès qui ne permettrait pas de se connecter de toute façon.
- `rule-evp-login-mismatch-no-address` (inferred) : ni l'adresse inscrite, ni celle du jeton, ni le `sub` ne figurent dans la redirection, les journaux ou une réponse (`rule-evp-secrets-never-exposed`).
- `rule-evp-login-mismatch-no-write` (inferred) : un refus `adresse_modifiee` ou `compte_recree` n'écrit rien (ni liaison, ni adresse, ni journal d'audit).
- `rule-evp-google-sign-in-audit`, `rule-evp-session-8h`, `rule-evp-google-error-causes` (inchangées, hors les deux lignes ajoutées au tableau des causes ci-dessus).

## Compatibilité
- Aucune opération ajoutée ou retirée, aucune forme de contrat modifiée : pas de rupture du contrat de référence.
- Changement de comportement : le cas « même `sub`, autre adresse » ouvrait la session et la refuse maintenant ; les tests de `rule-evp-google-sub-email-change` sont à remplacer par QA (litige à ouvrir par la fabrication : `OPEN: test rule-evp-google-sub-email-change : remplacée par rule-evp-google-sub-email-mismatch`).
- Le cas « même adresse, autre `sub` » reste un refus sans session ; seule la valeur de `erreur` passe de `non_autorise` à `compte_recree` : les tests de D-0008 attendent à mettre à jour.
