# Demande à l'API : sources en lecture seule et rapprochement PayFit

Écran demandeur : Sources (et, par effet, Détail d'une absence, Notifications, Accès, Les crèches). Besoin : voir l'état de chaque source, lancer une lecture manuelle, suivre son avancement, lire les anomalies ; la lecture PayFit alimente le rapprochement qui seul fait passer un dossier à « Présente dans PayFit ».

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /sources` | `sources:list` | user, admin (capacité `sources:read` : RH, superadmin) | aucune | `200 { items: [{ key: "workspace" \| "sheets" \| "payfit" \| "aqoona", label, state: "NEVER_READ" \| "UP_TO_DATE" \| "RUNNING" \| "ERROR" \| "UNAVAILABLE", lastReadAt: date-heure \| null, windowFrom: date \| null, windowTo: date \| null, volumes: [{ label, count }], anomalyCount, canRefresh: boolean, currentRunId: UUID \| null }] }` |
| `POST /sources/{key}/refresh` | `sources:refresh` | user, admin (`sources:refresh:payfit`, `sources:refresh:aqoona` : RH, superadmin ; `sources:refresh:sheets` : superadmin) | `key` ∈ {`sheets`, `payfit`, `aqoona`} ; corps vide | `202 { runId, state: "RUNNING" }` ; `403` ; `404` pour `workspace` ; `409 sources.run_in_progress` |
| `POST /sources/refresh-all` | `sources:refresh-all` | user, admin (`sources:refresh:sheets`, superadmin) | corps vide | `202 { runId, steps: ["sheets","payfit","aqoona"] }` ; `409 sources.run_in_progress` |
| `GET /sources/runs/{id}` | `sources:run` | user, admin (capacité `sources:read`) | `id` UUID | `200 { id, state: "RUNNING" \| "SUCCEEDED" \| "FAILED", step: { index, total, key } \| null, startedAt, finishedAt \| null, volumes: [{ label, count }], errorMessage: string \| null }` ; `404` |
| `GET /sources/{key}/anomalies` | `sources:anomalies` | user, admin (capacité `sources:read`) | `key` ∈ {`sheets`, `payfit`, `aqoona`} ; query `from` ≥ 0, `size` ∈ {10, 25, 50} | `200 { items: [{ type, label, subject, detail }], total }` ; `subject` et `detail` en français, sans matricule, NIR ni donnée médicale |

## Règles
- `rule-evp-sources-readonly` (user) : toutes les lectures sont en lecture seule ; aucun envoi ni écriture vers PayFit, Aqoona, Google Sheets ou Workspace.
- `rule-evp-sources-workspace-scope` (user) : Workspace ne fournit que l'adresse vérifiée, le domaine et le profil ; aucun accès à Gmail, calendrier ni Drive.
- `rule-evp-sources-sheets` (user) : l'onglet « Contacts des crèches » (nom, code de crèche, SIRET, adresse de connexion, nom de la directrice, nom et e-mail RO) construit le référentiel des crèches, confirme les affectations des directrices et signale les écarts RO sans écraser les choix administrés.
- `rule-evp-sources-sheets-superadmin` (user) : la lecture Sheets est réservée au superadmin et passe avant PayFit et Aqoona dans « toutes les sources ».
- `rule-evp-sources-payfit` (user) : lecture de la société (identifiant, SIRET), des collaboratrices (identifiant, prénom, nom), des contrats (identifiant, société, dates début et fin) et des absences (identifiant, type, statut, dates, demi-journées) sur la fenêtre du début de M−2 à la fin de M+2.
- `rule-evp-sources-aqoona` (user) : lecture de la référence de la personne (matricule utilisable, sinon prénom et nom), du nom de crèche, du jour et des heures de début et de fin, de J−28 à J+35 ; stockage du planning et des écarts d'appariement.
- `rule-evp-sources-nir-discarded` (user) : un matricule ressemblant à un NIR est écarté, jamais stocké ni affiché ; seul le décompte « Matricule écarté » est visible.
- `rule-evp-sources-manual` (user) : PayFit et Aqoona sont déclenchés manuellement par RH et superadmin ; aucun ordonnanceur, aucune lecture automatique.
- `rule-evp-sources-links` (user) : crèche et société PayFit liées par SIRET unique ; contrat identifié par société + contrat ; planning apparié par nom de crèche normalisé puis prénom et nom dans la crèche, rattaché si la correspondance est unique.
- `rule-evp-sources-no-invention` (user) : sans correspondance certaine, exclusion ou ligne non rattachée, et anomalie visible.
- `rule-evp-sources-no-auto-absence` (user) : aucun signal d'absence n'est produit automatiquement depuis Aqoona.
- `rule-evp-sources-ro-gaps-not-overwritten` (user) : un écart RO (ou une RO retirée présente dans le tableau) devient une anomalie ; aucun compte n'est créé, réactivé ni modifié par la lecture.
- `rule-evp-payfit-proof` (user) : un dossier passe à `DANS_PAYFIT` seulement si le rapprochement trouve une observation fraîche, exacte et unique : bonne société et bon SIRET, bon contrat, code d'absence compatible avec le type configuré, mêmes dates et demi-journées, statut source admissible ; sinon il reste « à vérifier ».
- `rule-evp-payfit-atomic-confirmation` (user) : la preuve, l'événement de confirmation et les notifications sont enregistrés ensemble dans une seule transaction.
- `rule-evp-payfit-alerts` (user) : après confirmation : absence modifiée → alerte de modification ; annulée → alerte d'annulation ; non retrouvée → alerte de disparition seulement si une lecture exhaustive admissible couvre la période et l'entité ; retrouvée à l'identique → événement de restauration, sans seconde confirmation. L'historique et la preuve antérieure sont conservés.
- `rule-evp-payfit-no-manual-confirm` (user) : aucune route ne confirme manuellement une présence.
- `rule-evp-sources-run-single` (inferred) : une seule lecture par source à la fois (`409 sources.run_in_progress`).
- `rule-evp-sources-refresh-audited` (inferred) : chaque lecture lancée écrit une entrée de journal (opération « Lecture de source », auteur « Système » pour les effets automatiques du rapprochement).
- `rule-evp-sources-credentials` (inferred) : les identifiants des sources sont une configuration de l'API ; aucun secret n'est lisible par une route.

## Compatibilité
Routes entièrement nouvelles (fonctionnalité `sources`). Les connecteurs réels (Google Sheets, PayFit, Aqoona) sont derrière une interface remplaçable par un double de test pour la recette. Pas de rupture de contrat.
