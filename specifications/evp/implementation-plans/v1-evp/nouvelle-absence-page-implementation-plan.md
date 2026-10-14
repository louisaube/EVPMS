# Écran Nouvelle absence (`/declarations/nouvelle`) : plan de réalisation

Objet : déclarer une absence pour une salariée d'une crèche du périmètre : crèche, contrat PayFit importé, type, dates avec demi-journées, justificatif. Réservé à la directrice, à la RO, à RH et au superadmin. Définit aussi le composant `JustificatifUploader`, réutilisé par le détail d'une absence.

## Réutilisation
`useCall`, `notify`, `PageHeader` et les états communs de la mise en page (`EtatAttente`, `EtatErreur`, `EtatInterdit`, `BandeVigilance`) ; la liste de contrats à recherche suit le même chargement par `useCall` que les listes à choix de `features/users` (pas de bibliothèque de formulaire ajoutée). `JustificatifUploader` est écrit une seule fois dans `studio/src/app/shared/components/` et réutilisé par le détail ; il parle à l'API par le client `@evpms/api-client` et envoie le `PUT` par `fetch` natif (sans cookie, `credentials: 'omit'`).

## Parcours
1. L'utilisateur ouvre « Nouvelle absence ». Attente pendant `GET /creches` et `GET /absence-types`.
2. Il choisit la crèche (présélectionnée si une seule), puis la salariée et son contrat dans la liste des contrats importés de PayFit pour cette crèche (recherche par nom).
3. Il choisit le type : le formulaire affiche le justificatif prévu (« Pièce attendue : avis d'arrêt (pièce privée) ») et la mention « Examen RH » lorsque le type en demande un.
4. Il saisit début et fin et, à chaque borne, matin ou après-midi. Si le début est postérieur à aujourd'hui, un message annonce « Cette absence débute dans le futur : elle sera enregistrée comme « Anticipée ». ».
5. Il joint le justificatif (dépôt, voir plus bas) si le type en prévoit un.
6. « Enregistrer » : contrôle local des champs, puis `POST /absences`. Résultats :
   - `201` : navigation vers `/declarations/:id` avec la notification « Absence enregistrée. » complétée par l'état : « Le dossier est « À valider ». » / « Le dossier est « Anticipée ». » / « Le dossier est « À compléter » : voir les motifs. ».
   - `200` avec `duplicate: true` : navigation vers le dossier existant avec « Cette absence existe déjà : voici le dossier. » (aucun doublon créé).
   - `409` / `422` : alerte au-dessus du bouton (voir tableau des erreurs), saisies conservées.
7. « Annuler » revient à `/declarations` (confirmation « Abandonner la saisie ? » seulement si le formulaire a été modifié).

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Nouvelle absence » (`h1`) | — | — |
| Champ crèche | « Crèche » (liste obligatoire) | Options : crèches du périmètre ; changer la crèche vide salariée et pièces déposées (avec confirmation si une pièce existe) | `GET /creches` |
| Champ salariée et contrat | « Salariée et contrat » (liste avec recherche, obligatoire, désactivée sans crèche) | Option : « <Prénom Nom> — contrat du jj/mm/aaaa au jj/mm/aaaa » (« en cours » si sans fin) et, en texte secondaire, « Contrat PayFit : <identifiant> » ; chargement paginé par recherche (3 caractères pour lancer ; 20 résultats) ; aide « Seuls les contrats importés de PayFit sont proposés. » | `GET /creches/{code}/contracts?search=` |
| Message de liste vide | « Aucun contrat importé pour cette crèche. Demandez une lecture PayFit à la RH. » | Affiché si aucun résultat sans recherche | idem |
| Champ type | « Type d'absence » (liste obligatoire) | Les 9 types ; sous le champ : « Pièce attendue : <libellé> » (+ « pièce privée » / « Examen RH » selon le type) ou « Aucun justificatif requis. » | `GET /absence-types` |
| Date de début | « Date de début » (date native, obligatoire) | — | — |
| Demi-journée de début | « Début : » avec choix « Matin » / « Après-midi » (groupe radio, « Matin » par défaut) | « Après-midi » = l'absence commence l'après-midi | — |
| Date de fin | « Date de fin » (date native, obligatoire) | ≥ date de début | — |
| Demi-journée de fin | « Fin : » avec choix « Matin » / « Après-midi » (« Après-midi » par défaut) | Début et fin le même jour : « Après-midi » au début et « Matin » à la fin est refusé | — |
| Résumé de période | « Du 03/11/2026 (matin) au 05/11/2026 (après-midi) » (`aria-live="polite"`) | Relit les choix | — |
| Message d'anticipation | « Cette absence débute dans le futur : elle sera enregistrée comme « Anticipée ». » | Affiché si début > aujourd'hui (fuseau Europe/Paris) | — |
| Zone justificatif | `JustificatifUploader`, titre « Justificatif » | Voir ci-dessous ; affichée seulement si le type prévoit une pièce, sinon masquée | `POST /justificatifs/authorize-upload`, envoi, `POST /justificatifs/{id}/confirm` |
| Commentaire | « Commentaire administratif (facultatif) » (texte multiligne, 0 à 500 caractères, compteur) | Aide : « N'indiquez aucun détail médical (diagnostic, symptômes, pathologie). » | — |
| Bouton principal | « Enregistrer » ; « Enregistrement en cours… » pendant l'envoi | Désactivé pendant un dépôt de pièce ou un envoi ; un seul envoi malgré des clics répétés | `POST /absences` |
| Bouton secondaire | « Annuler » | Retour à la liste | — |
| Alerte d'erreur | `role="alert"` au-dessus des boutons | Voir tableau | — |

### Composant `JustificatifUploader`
| Élément | Libellé exact | Comportement |
|---|---|---|
| Zone | « Glissez un fichier PDF, JPEG ou PNG ici » + bouton « Choisir un fichier » (champ caché `accept=".pdf,.jpg,.jpeg,.png"`, nom accessible « Justificatif à joindre ») | Un fichier à la fois ; réinitialisé après chaque sélection |
| Aide | « PDF, JPEG ou PNG, 10 Mio au maximum. » | — |
| Contrôles locaux | extension/type hors `.pdf .jpg .jpeg .png` : « Format non pris en charge. Déposez un PDF, un JPEG ou un PNG. » ; 0 octet : « Le fichier est vide. » ; > 10 485 760 octets : « Le fichier est trop volumineux (maximum 10 Mio). » | Un fichier refusé localement n'est ni annoncé ni envoyé |
| Étape 1 | « Autorisation… » | `POST /justificatifs/authorize-upload` avec nom, type MIME, taille annoncée, crèche (et dossier si connu) |
| Étape 2 | « Envoi du fichier… » + barre de progression et bouton « Annuler l'envoi » | `PUT` direct du fichier vers l'URL d'envoi temporaire (valable 5 minutes) ; le studio ne la conserve ni ne l'affiche ; aucun cookie envoyé à ce domaine |
| Étape 3 | « Vérification du fichier… » | `POST /justificatifs/{id}/confirm` ; l'API contrôle la taille réelle et la signature de format |
| Résultat | Ligne « <nom du fichier> — <taille en Ko/Mio> — Confirmé » avec coche et bouton « Retirer <nom> » | Le justificatif confirmé est transmis à `POST /absences` (`justificatifIds`) ; « Retirer » le détache seulement du formulaire |
| Délai dépassé | Si plus de 5 minutes séparent l'autorisation du début de l'envoi : nouvelle autorisation automatique, silencieuse | — |
| Échecs | `justificatifs.size_mismatch`, `justificatifs.signature_mismatch`, `justificatifs.not_uploaded`, `justificatifs.upload_expired`, `403` : « Ce fichier n'a pas pu être validé. Vérifiez qu'il s'agit d'un PDF, d'un JPEG ou d'un PNG de 10 Mio au maximum, puis réessayez. » ; échec réseau pendant l'envoi : « L'envoi a échoué. Réessayez. » avec « Réessayer » | Le fichier est oublié |

### Erreurs de l'enregistrement
| Réponse | Message |
|---|---|
| `400 api.validation.incoming_failed` | « Données invalides. Vérifiez les champs. » + erreurs sous les champs concernés |
| `403` | « Action non autorisée. » |
| `404 absences.contract_not_found` | « Ce contrat n'existe plus pour cette crèche. Rechargez la liste. » |
| `409 absences.creche_contract_mismatch` | « Ce contrat n'appartient pas à la crèche choisie. » |
| `409 absences.piece_not_attachable` | « Un justificatif n'est plus utilisable. Retirez-le et déposez-le à nouveau. » || autres | `rule-foundation-api-failure-handling` |

Les blocages de complétude (période hors contrat, chevauchement EVP ou PayFit, pièce manquante ou non confirmée) ne sont **pas** des erreurs : l'API enregistre le dossier en « À compléter » et l'écran de détail les explique.

## Règles
- `rule-evp-declare-steps` (user) : crèche du périmètre, puis salariée et contrat PayFit importé, type, dates avec matin/après-midi à chaque borne, justificatif, enregistrement.
- `rule-evp-declare-roles` (user) : écran réservé à directrice, RO, RH et superadmin ; pas d'administratrice.
- `rule-evp-declare-result-status` (user) : blocage donne « À compléter » ; début futur donne « Anticipée » ; sinon « À valider ». Décidé par l'API, annoncé par l'écran.
- `rule-evp-declare-duplicate` (user) : un doublon exact actif est renvoyé au lieu d'être recréé ; l'écran ouvre le dossier existant.
- `rule-evp-declare-no-medical-detail` (user) : l'aide du commentaire interdit tout détail médical ; l'API n'écrit jamais ce commentaire dans les journaux.
- `rule-evp-declare-employee-key` (user) : la salariée est choisie par son contrat (société + contrat), pas par son nom seul.
- `rule-evp-declare-half-day-order` (inferred) : fin ≥ début (date puis demi-journée) ; validation locale pour l'aide, l'API tranche.
- `rule-evp-declare-types-defaults` (user) : types par défaut et pièce prévue pour chacun (voir `absences` côté API).
- `rule-evp-attach-formats` (user) : PDF, JPEG ou PNG, 10 485 760 octets au maximum ; contrôle local de commodité, contrôle réel par l'API.
- `rule-evp-attach-temp-upload` (user) : envoi par URL temporaire de 5 minutes vers un stockage privé, confirmation par le serveur ; aucun lien public permanent.
- `rule-evp-attach-no-files-in-db` (user) : le studio n'envoie jamais les octets à l'API EVP ni ne les garde.
- `rule-evp-declare-max-pieces` (inferred) : 5 pièces au plus par dossier.
- `rule-evp-declare-validation-local` (inferred) : crèche, contrat, type, dates obligatoires ; message sous le champ « Ce champ est obligatoire. ».

## Accès
Capacité `absences:create` (directrice, RO, RH, superadmin). L'administratrice voit « Accès refusé » à l'adresse directe. Les crèches proposées sont celles du périmètre ; une crèche hors périmètre est refusée `403` par l'API et la base.

## Hypothèses
- « Anticipation » de la demande est traitée comme un message calculé, pas comme une case à cocher : la date de début décide de l'état « Anticipée ».
- Un champ de commentaire administratif facultatif existe (la demande parle de « commentaires » sans fixer de champ) ; borne de 500 caractères inférée.
- La recherche de salariée se déclenche à partir de 3 caractères ; sans recherche, les 20 premiers contrats de la crèche sont proposés.
- Les pièces sont déposées avant l'enregistrement du dossier (parcours d'autorisation puis dépôt puis confirmation) et rattachées par `POST /absences` ; un dépôt abandonné reste une pièce confirmée non rattachée, nettoyée par l'API (hors périmètre de l'écran).
- Un type avec deux pièces (accident du travail : certificat et déclaration) laisse déposer plusieurs fichiers ; le studio ne vérifie pas la nature de chaque pièce.
- Le fuseau d'« aujourd'hui » est Europe/Paris.
