# Écran Détail d'une absence (`/declarations/:id`) : plan de réalisation

Objet : la fiche d'un dossier. Elle répond aux quatre questions : où en est le dossier, qui doit agir, pourquoi il est bloqué, quelle est la prochaine action. Elle réunit les dates, les pièces, les décisions permises, l'éventuelle alerte PayFit, la chronologie et l'audit. Les décisions (valider, retourner, refuser) sont réservées à Marine (RH).

## Parcours
1. Arrivée depuis une liste, une notification ou une adresse. Attente pendant `GET /absences/{id}` (et `GET /absences/{id}/audit` si la capacité `journal:read` est présente).
2. L'utilisateur lit l'en-tête (statut, qui doit agir, prochaine action), le bandeau de blocage s'il y en a un, les dates, les pièces, l'alerte PayFit, la chronologie.
3. Il agit avec les boutons proposés par l'API (`allowedActions`) : soumettre, ajouter un justificatif, valider, retourner, refuser, annuler, déclarer la saisie effectuée. Chaque action ouvre un dialogue de confirmation ; retourner, refuser et annuler exigent un motif administratif.
4. Après une action : le dossier est relu, la chronologie mise à jour, la notification de succès affichée. Un `409` indique que le dossier a changé : message et relecture.
5. Dossier introuvable ou hors périmètre : écran « Dossier introuvable » (`404`, indiscernable d'un dossier inexistant), avec le bouton « Retour aux déclarations ».

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Lien retour | « Les déclarations » (flèche) | Vers `/declarations` en conservant les filtres précédents si présents | — |
| Titre | « <Prénom Nom> · <Type d'absence> » (`h1`) | Sous-titre : « <Crèche> · Contrat PayFit <identifiant> · Mois de paie : <mois année> » | `GET /absences/{id}` |
| Statut | `StatutAbsence` | Libellé complet ; pour `A_SAISIR` : « Validée, à saisir dans PayFit » (jamais « Dans PayFit ») | `status`, `saisieDeclaree` |
| Bloc « Où en est le dossier » | « Où en est le dossier » (`h2`) | Progression en cinq étapes : « Déclarée », « Contrôlée », « Validée », « Saisie dans PayFit », « Présente dans PayFit » ; l'étape courante `aria-current="step"`, texte « Étape 3 sur 5 : Validée » ; états terminaux « Rejetée » / « Annulée » remplacent la progression par une phrase | `progress` |
| Bloc « Qui doit agir » | « Qui doit agir » | `nextAction.actorLabel` ; ex. « RH » | `nextAction` |
| Bloc « Prochaine action » | « Prochaine action » | `nextAction.label` ; ex. « Valider le dossier » | `nextAction` |
| Bandeau « Pourquoi il est bloqué » | « Pourquoi ce dossier est bloqué » (fond vigilance, `role="status"`) | Une ligne par blocage (`blockages[].message`) : pièce manquante, pièce non confirmée, période hors contrat, chevauchement avec une absence EVP (lien vers l'autre dossier) ou PayFit, identité crèche/contrat ; masqué si aucun blocage | `blockages` |
| Mention de décision | « Retourné par <nom> le jj/mm/aaaa : <motif administratif> » (ou « Refusé… », « Annulé… ») | Affichée pour `A_COMPLETER` après retour, `REJETEE`, `ANNULEE` | `lastDecision` |
| Carte « Dates » | « Du 03/11/2026 (matin) au 05/11/2026 (après-midi) » ; « Type : Arrêt maladie » ; « Code PayFit attendu : <code> » ; « Déclarée le … par <nom> » ; commentaire administratif s'il existe | Lecture seule | `GET /absences/{id}` |
| Carte « Pièces » | « Pièces » (`h2`) ; ligne par pièce : nom, taille, « Confirmée », « Ajoutée le … par <nom> », mention « Pièce privée » le cas échéant, bouton « Ouvrir <nom> » | « Ouvrir » demande un lien de lecture (valable 60 s) et l'ouvre dans un nouvel onglet ; l'ouverture est journalisée par l'API ; lien jamais conservé ni affiché ; pièce non autorisée pour le rôle : bouton absent et mention « Réservée à la RH » | `POST /justificatifs/{id}/read-link` |
| Pièce attendue | « Pièce attendue : avis d'arrêt » / « Aucun justificatif requis. » ; « Examen RH » si le type l'exige | — | `expectedPiece` |
| Ajout de pièce | `JustificatifUploader` (voir `nouvelle-absence`), bouton « Ajouter un justificatif » | Visible si `allowedActions` contient `ATTACH` ; le dépôt est rattaché au dossier à la confirmation, les contrôles sont rejoués | `POST /justificatifs/authorize-upload` (avec `absenceId`), `…/confirm` |
| Carte « Alerte PayFit » | « Alerte PayFit » (`h2`), fond vigilance | Visible si `payfitAlert` non nul : « Absence modifiée dans PayFit », « Absence annulée dans PayFit », « Absence non retrouvée dans PayFit » ; détail (date de l'observation, ce qui a changé) ; « La preuve antérieure est conservée : <date>, code <code>. » ; mention « À arbitrer par la RH. » ; aucun bouton pour effacer ou décréter | `payfitAlert`, `payfitProof` |
| Bandeau de restauration | « Absence retrouvée à l'identique dans PayFit le jj/mm/aaaa. » | Si un événement de restauration existe ; aucune seconde confirmation affichée | chronologie |
| Carte « Preuve PayFit » | « Observation PayFit » : date, société, code, statut source | Visible pour `DANS_PAYFIT` ; texte « Confirmée automatiquement par rapprochement, jamais manuellement. » | `payfitProof` |
| Boutons de décision | « Soumettre à nouveau » (`SUBMIT`), « Valider » (`VALIDATE`), « Retourner pour complément » (`RETURN`), « Refuser » (`REJECT`), « Annuler la déclaration » (`CANCEL`), « Saisie effectuée » (`MARK_ENTERED`) | N'apparaissent que si présents dans `allowedActions` ; désactivés pendant un envoi ; le premier bouton d'action de l'étape est le bouton principal | `POST /absences/{id}/submit`, `validate`, `return`, `reject`, `cancel`, `mark-entered` |
| Rappel sous « Valider » | « Valider ne transmet rien à PayFit : la saisie reste une action humaine. » | Texte fixe dans le dialogue et sous le bouton | — |
| Dialogue de motif | Titre selon l'action ; champ « Motif administratif » (obligatoire, 1 à 500 caractères, compteur) ; aide « Sans détail médical. » ; boutons « Annuler » et « Confirmer » | Motif vide : « Le motif est obligatoire. » ; pendant l'envoi : boutons désactivés | `return`, `reject`, `cancel` |
| Dialogue de saisie effectuée | « Confirmer que la saisie a été faite dans PayFit ? Le dossier restera « à vérifier » tant que PayFit n'aura pas apporté de preuve. » ; « Annuler » / « Confirmer » | — | `mark-entered` |
| Carte « Chronologie » | « Chronologie » (`h2`) | Liste antéchronologique : date-heure, événement (déclaration, contrôles rejoués, pièce ajoutée, décisions avec motif, saisie déclarée, confirmation / modification / annulation / disparition / restauration PayFit), auteur | `timeline` |
| Carte « Audit » | « Audit » (`h2`) | Visible si capacité `journal:read` (RH, superadmin) : actions horodatées, auteur, opération, détail administratif, y compris ouvertures de pièces | `GET /absences/{id}/audit` |
| États | Attente, erreur « Réessayer », `404` « Dossier introuvable », interdit | Voir mise en page | — |

### Boutons selon l'état (indicatif ; l'API fait foi via `allowedActions`, calculé depuis la table des transitions du plan du module `evp-module-implementation-plan.md`)
| État | Déclarant (directrice, RO, superadmin, RH en tant que déclarant) | RH (Marine), en plus | Administratrice |
|---|---|---|---|
| `A_COMPLETER` | Ajouter un justificatif, Soumettre à nouveau, Annuler | Refuser | aucun |
| `ANTICIPEE` | Ajouter un justificatif, Soumettre à nouveau (quand la date approche), Annuler | Retourner, Refuser | aucun |
| `A_VALIDER` | Ajouter un justificatif, Soumettre à nouveau, Annuler | Valider, Retourner, Refuser | aucun |
| `A_SAISIR` | — | Saisie effectuée, Retourner, Refuser, Annuler | aucun |
| `DANS_PAYFIT`, `REJETEE`, `ANNULEE` | — | — | aucun |

Le superadmin édite et soumet comme un déclarant mais ne voit jamais « Valider », « Retourner », « Refuser » ni « Saisie effectuée ».

## Règles
- `rule-evp-detail-four-questions` (user) : la fiche répond à où en est le dossier, qui doit agir, pourquoi il est bloqué, quelle est la prochaine action.
- `rule-evp-detail-content` (user) : la fiche réunit dates, pièces, prochaine action, décision, chronologie et éventuelle alerte PayFit ; progression, décisions permises et audit y figurent aussi.
- `rule-evp-detail-no-general-edit` (user) : pas de formulaire général d'édition ; seulement l'ajout de justificatif et les décisions.
- `rule-evp-decision-marine-only` (user) : valider, refuser et demander un complément (retourner) ne sont proposés qu'à Marine (RH) ; le superadmin ne valide pas ; l'API refuse `403` aux autres.
- `rule-evp-decision-states` (user) : états du cycle : À compléter, Anticipée, À valider, Validée « à saisir » (A_SAISIR), Présente dans PayFit (DANS_PAYFIT), Rejetée, Annulée.
- `rule-evp-decision-reason-required` (user) : retourner, refuser et annuler exigent un motif administratif sans détail médical ; retour donne « À compléter », refus donne « Rejetée ».
- `rule-evp-decision-replay-controls` (user) : toute soumission, resoumission ou validation rejoue les contrôles ; l'écran affiche les blocages rendus par l'API.
- `rule-evp-validated-is-to-enter` (user) : « Validée » s'affiche « à saisir dans PayFit », et seul le rapprochement probant fait passer à « Présente dans PayFit ».
- `rule-evp-mark-entered-no-proof` (user) : « Saisie effectuée » ne change pas l'état tant que PayFit n'a pas apporté de preuve ; seul le libellé devient « Saisie déclarée, à vérifier dans PayFit ».
- `rule-evp-payfit-no-manual-confirm` (user) : aucun bouton ne permet de confirmer manuellement une présence PayFit.
- `rule-evp-payfit-alerts` (user) : après confirmation, une modification, une annulation ou une disparition PayFit affichent une alerte sans effacer la preuve antérieure ; une restauration à l'identique est un événement, sans seconde confirmation.
- `rule-evp-arbitrage-rh` (user) : « À arbitrer » revient à Marine, jamais à une RO ; la fiche l'écrit ainsi.
- `rule-evp-notification-read-no-effect` (user) : ouvrir un dossier depuis une notification ne change rien au dossier.
- `rule-evp-piece-read-link` (user) : l'ouverture d'une pièce passe par un lien de lecture de 60 secondes, journalisé ; aucun lien permanent n'est affiché ni conservé.
- `rule-evp-piece-no-medical-in-logs` (user) : aucun nom de fichier ni contenu médical n'est écrit dans les journaux techniques du studio (pas de `console.log` de pièces).
- `rule-evp-detail-actions-from-api` (inferred) : le studio affiche exactement les actions de `allowedActions` et ne recalcule aucun droit ni aucune transition.
- `rule-evp-detail-conflict-refresh` (inferred) : `409 absences.decision_not_allowed` : message « Le dossier a changé. Il vient d'être rechargé. » et relecture.
- `rule-evp-detail-404-indistinct` (inferred) : dossier hors périmètre et dossier inexistant donnent le même écran.
- `rule-evp-detail-private-piece` (inferred) : une pièce privée (arrêt maladie) n'est ouvrable que si l'API fournit `canOpen = true` ; sinon seul son nom de type est visible.

## Accès
Tous les rôles voient la fiche des dossiers de leur périmètre (directrice, RO : leurs crèches ; RH, administratrice, superadmin : tous). Les boutons dépendent de `allowedActions`. L'administratrice n'a aucune action. L'audit n'est visible que pour RH et superadmin.

## Hypothèses
- États autorisés par décision : ceux de la table des transitions du plan du module (valider depuis « À valider » ; retourner depuis « Anticipée », « À valider » et « Validée, à saisir » ; refuser depuis « À compléter », « Anticipée », « À valider » et « Validée, à saisir » ; annuler depuis « À compléter », « Anticipée » et « À valider », et « Validée, à saisir » pour RH seulement ; saisie effectuée depuis « Validée, à saisir »). Le studio n'en code aucune.
- La modification d'un dossier existe côté serveur (`PATCH /absences/{id}`) mais n'a aucun écran ni bouton ici.
- « Annuler » et « écarter » de la demande sont une seule décision, « Annuler la déclaration ».
- Une validation dont les contrôles échouent n'est pas appliquée : le dossier garde son état, l'API renvoie les blocages, et Marine peut le retourner ; la demande dit « restant bloqués » sans préciser l'état résultant.
- La progression en cinq étapes est une représentation inférée des états ; « Contrôlée » est atteinte dès qu'un dossier est « À valider » ou « Anticipée ».
- Le seul « à déclarer » mentionné par la demande (soumission) n'est pas un état distinct : il est traité comme « À compléter » ou « Anticipée ».
- Les pièces privées ne sont ouvrables que par RH, superadmin et la personne qui les a déposées ; l'administratrice ne voit que les pièces non privées (« justificatifs autorisés »).
- « Audit » reprend les entrées du journal relatives au dossier (même source que l'écran Journal).
