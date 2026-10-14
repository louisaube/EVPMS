# Demande à l'API : crèches, contrats importés et clôture mensuelle

Écrans demandeurs : Les crèches, Nouvelle absence, Les déclarations, À faire, Accès. Besoin : lister les crèches visibles, proposer les contrats PayFit importés d'une crèche, lire et attester la clôture d'un mois de paie.

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /creches` | `creches:list` | user, admin (tout compte EVP) | aucune | `200 { items: [{ code, name, siret, directriceName: string \| null, roNames: string[], verified: boolean }] }` ; directrice et RO : leurs crèches ; RH, administratrice, superadmin : toutes |
| `GET /creches/{code}/contracts` | `creches:contracts` | user, admin (capacité `absences:create`, crèche du périmètre) | `code` 1..20 ; query `search` 0..100 (lancée par le studio à partir de 3 caractères), `size` entier 1..20 (défaut 20) | `200 { items: [{ contractId: UUID, payfitContractId, employeeName, startDate, endDate: date \| null }] }` ; contrats de la société PayFit rattachée à la crèche par SIRET ; `403` ou `404` hors périmètre |
| `GET /creches/{code}/closures` | `closures:list` | user, admin (tout compte EVP, crèche du périmètre) | `code` 1..20 | `200 { items: [{ month: "AAAA-MM", status: "OUVERT" \| "CLOTURE", openCount, closedAt: date-heure \| null, closedByName: string \| null }] }` : mois de paie courant et cinq précédents, plus tout mois clôturé ; `404` hors périmètre |
| `POST /creches/{code}/closures/{month}` | `closures:attest` | user, admin (rôles déclarants dans leur périmètre) | `code` 1..20, `month` motif `^\d{4}-(0[1-9]\|1[0-2])$`, corps `{ attested: true }` | `200 { month, status: "CLOTURE", closedAt, closedByName }` ; `400` si `attested` n'est pas `true` ou mois futur ; `403` ; `404` ; `409 closures.open_absences` avec `details.openCount` ; `409 closures.already_closed` |

## Règles
- `rule-evp-creche-scope` (user) : directrice et RO ne voient que leurs crèches (affectations explicites pour la RO) ; consultation globale pour RH, administratrice et superadmin ; garanti par la base.
- `rule-evp-creche-readonly` (inferred) : aucune route ne crée ni ne modifie une crèche ; le référentiel provient de la lecture du Google Sheets « Contacts des crèches » (voir demande Sources). `verified` est vrai pour une crèche présente dans la dernière lecture réussie.
- `rule-evp-creche-link-siret` (user) : crèche et société PayFit sont liées par SIRET unique ; sans correspondance unique, aucun contrat n'est proposé et une anomalie est visible dans Sources.
- `rule-evp-declare-employee-key` (user) : un contrat est identifié par société + contrat ; `contractId` est l'identifiant local de ce couple.
- `rule-evp-closure-attest` (user) : la clôture enregistre l'attestation de vérification des absences (auteur, instant).
- `rule-evp-closure-open-blocks` (user) : un dossier ouvert, même « à saisir », bloque la clôture ; ouvert = `A_COMPLETER`, `ANTICIPEE`, `A_VALIDER`, `A_SAISIR`, pour le mois de paie et la crèche, rejoué à l'attestation.
- `rule-evp-closure-payroll-month` (user) : le mois de paie d'un dossier suit la règle du 25 (voir demande Absences).
- `rule-evp-closure-api-roles` (user) : l'API autorise la clôture aux rôles déclarants (directrice, RO, RH, superadmin) dans leur périmètre ; l'administratrice reçoit `403`.
- `rule-evp-closure-audited` (inferred) : la clôture écrit une entrée de journal dans la même transaction.
- `rule-evp-closure-no-reopen` (inferred) : aucune route de réouverture.
- `rule-evp-closure-month-bounds` (inferred) : un mois futur (au sens du mois de paie courant) est refusé `400`.

## Compatibilité
Routes entièrement nouvelles (fonctionnalités `creches`, `closures`). Le comportement d'une déclaration dans un mois déjà clôturé n'est pas défini par la demande : l'API ne la refuse pas (point à arbitrer, voir plan « Les crèches »). Pas de rupture de contrat.
