# Écran Paramètres (`/parametres`) : plan de réalisation

Objet : consultation seule du compte connecté, de ses accès (rôle, crèches, droits) et de la configuration visible d'EVP (types d'absence, durées, fenêtres de lecture, état des écritures PayFit). Aucune modification, aucun secret.

## Parcours
1. L'utilisateur ouvre « Paramètres ». Attente pendant `GET /profile` et `GET /settings`.
2. Il lit trois sections : « Mon compte », « Mes accès », « Configuration ».
3. États : attente, erreur avec « Réessayer ». Pas de formulaire, donc pas d'état de succès.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Paramètres » (`h1`) | — | — |
| Note | « Cet écran est en consultation. Les accès se modifient dans « Accès » (RH, administratrice, superadmin) ; les types d'absence et les secrets ne s'éditent pas dans EVP. » | Texte fixe | — |
| Section « Mon compte » | Nom, adresse e-mail Workspace, rôle (pastille), statut « Actif » | Lecture seule | `GET /profile` |
| Session | « Votre session expire le jj/mm/aaaa à hh:mm (durée : 8 heures). » | Affichée si `sessionExpiresAt` est fourni | `GET /profile` |
| Section « Mes accès » | « Crèches accessibles » : liste (nom, code), ou « Toutes les crèches » pour les rôles à consultation globale | Lecture seule | `creches`, `scope` |
| Droits | « Ce que vous pouvez faire » : liste de phrases (ex. « Déclarer une absence », « Valider, refuser ou demander un complément », « Télécharger l'export paie », « Gérer les accès des RO ») ; « Ce que vous ne pouvez pas faire » : phrases des droits absents (ex. « Valider une absence », « Télécharger l'export ») | Phrases issues des `capabilities` (table de correspondance dans le studio, repli : code) | `capabilities` |
| Section « Configuration » | tableau « Types d'absence » : « Type », « Justificatif prévu », « Examen RH », « Code PayFit » | 9 types ; « Aucun justificatif requis » ; code PayFit attendu pour le rapprochement | `GET /settings` (`absenceTypes`) |
| Durées et limites | « Session : 8 heures », « Lien d'envoi d'un justificatif : 5 minutes », « Lien de lecture d'un justificatif : 60 secondes », « Taille maximale d'un justificatif : 10 Mio (10 485 760 octets) », « Formats acceptés : PDF, JPEG, PNG » | Lecture seule | `GET /settings` (`limits`) |
| Fenêtres de lecture | « PayFit : du début de M−2 à la fin de M+2 », « Aqoona : de J−28 à J+35 » | Lecture seule | `GET /settings` (`windows`) |
| Écritures PayFit | « Les écritures dans PayFit sont désactivées. » (état « Désactivées ») | Toujours affiché | `payfitWritesEnabled` |
| Secrets | aucun | Aucune clé, aucun jeton, aucun identifiant de service n'est jamais affiché | — |
| Bouton | « Réessayer » en cas d'erreur | — | — |

## Règles
- `rule-evp-settings-readonly` (user) : l'écran Paramètres montre compte, accès et configuration visible, en consultation.
- `rule-evp-settings-no-editor` (user) : pas d'éditeur de secrets ni de types d'absence (hors demande).
- `rule-evp-settings-no-secret` (inferred) : aucun secret, clé ni identifiant de service n'est affiché.
- `rule-evp-settings-payfit-disabled` (user) : l'état « écritures PayFit désactivées » est affiché.
- `rule-evp-settings-limits-visible` (user) : les durées de session et de liens (8 h, 5 min, 60 s) et la taille maximale (10 485 760 octets) sont affichées.
- `rule-evp-settings-types-defaults` (user) : les types d'absence par défaut et leur pièce prévue sont affichés (congés payés, arrêt maladie, sans solde, enfant malade, accident du travail, récupération, sans justificatif, événement familial, autre).
- `rule-evp-settings-all-roles` (inferred) : l'écran est ouvert à tous les rôles ; le contenu « Mes accès » dépend du compte.
- `rule-evp-settings-capability-sentences` (inferred) : les phrases de droits viennent d'une table du studio ; elles sont informatives, la sécurité est côté API.

## Accès
Tous les rôles connectés.

## Hypothèses
- La colonne « Code PayFit » affiche le code d'absence configuré côté serveur pour le rapprochement ; si le code n'est pas configuré, « Non configuré ».
- « Examen RH » : drapeau informatif porté par le type (sans solde, accident du travail, récupération, sans justificatif, autre) ; il n'a pas d'effet bloquant propre dans cette version.
- Le nom, l'e-mail et le rôle sont ceux de la liste des utilisateurs autorisés, pas ceux du profil Google.
