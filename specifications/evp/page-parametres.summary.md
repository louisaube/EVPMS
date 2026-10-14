# Paramètres (`/parametres`) : état réalisé

Consultation du compte, des accès et de la configuration visible. Code : `studio/src/app/features/settings/pages/ParametresPage.tsx`, `features/auth/hooks/useProfile.tsx`, `shared/labels.ts` ; API : `GET /profile` et `GET /settings` (`features/profile/`, `features/settings/`). Plan : `v1-evp/parametres-page-implementation-plan.md`.

## Ce qui existe
- **Tous les rôles connectés** (`rule-evp-settings-all-roles` inferred) ; aucun formulaire, aucun éditeur de secret ni de type d'absence (`rule-evp-settings-readonly` user, `rule-evp-settings-no-editor` user). Note « Cet écran est en consultation. Les accès se modifient dans « Accès » (RH, administratrice, superadmin) ; les types d'absence et les secrets ne s'éditent pas dans EVP. ».
- **Mon compte** : nom, adresse e-mail, pastille de rôle, « Actif », et « Votre session expire le … (durée : 8 heures). » quand `sessionExpiresAt` est fourni.
- **Mes accès** : « Crèches accessibles » (« Toutes les crèches » pour la consultation globale, sinon nom et code, « Aucune crèche » sinon), « Ce que vous pouvez faire » et « Ce que vous ne pouvez pas faire » : phrases tirées d'une table du studio selon les `capabilities` du profil (`rule-evp-settings-capability-sentences` inferred, informative, la sécurité reste côté API ; « Rien de restreint parmi les droits listés. » si rien n'est refusé).
- **Configuration** (`GET /settings`) : tableau « Types d'absence » (« Type », « Justificatif prévu » avec « (pièce privée) » ou « Aucun justificatif requis », « Examen RH », « Code PayFit » ou « Non configuré ») en cartes sous 767 px (`rule-evp-settings-types-defaults` user) ; « Durées et limites » : session en heures, lien d'envoi en minutes, lien de lecture en secondes, « Taille maximale d'un justificatif : 10 Mio (10 485 760 octets) », formats acceptés (`rule-evp-settings-limits-visible` user) ; « Fenêtres de lecture » PayFit et Aqoona (textes de l'API) ; « Les écritures dans PayFit sont désactivées. (État : Désactivées) », affiché en dur (`rule-evp-settings-payfit-disabled` user).
- **Aucun secret** (`rule-evp-settings-no-secret` inferred) : la réponse de l'API est une liste blanche ; l'écran n'affiche ni clé, ni jeton, ni identifiant de service.
- **États** : attente et « Réessayer » pour la section Configuration.

## Limites connues
- Les codes PayFit des types sont vides à l'amorçage : la colonne affiche « Non configuré » tant que rien n'est posé en base ; un type sans code compatible ne peut pas être confirmé par le rapprochement. Depuis la v2, avec le pilote `real` seulement, `payfitCode` retombe sur le premier code du fichier `api/config/payfit-absence-types.json` quand la colonne `absence_types.payfit_code` est vide (`rule-evp-payfit-type-mapping` user) ; l'écran ne change pas.
- Le nom, l'e-mail et le rôle sont ceux de la liste des comptes autorisés, non du profil Google.
- Le profil est chargé avec la mise en page ; un échec de `GET /profile` affiche l'état d'erreur plein écran avant cette page.
- Aucun test de navigateur n'a été exécuté pour ce résumé.
