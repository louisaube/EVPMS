# Les crèches (`/creches`) : état réalisé

Crèches visibles de l'utilisateur et clôture mensuelle. Code : `studio/src/app/features/creches/pages/CrechesPage.tsx`, `features/creches/hooks/useCreches.ts` ; API : `GET /creches`, `GET /creches/:code/closures`, `POST /creches/:code/closures/:month` (`features/creches/`, `features/closures/`). Plan : `v1-evp/creches-page-implementation-plan.md`.

## Ce qui existe
- **Cartes de crèches** (`rule-evp-creche-scope` user, `rule-evp-creche-readonly` inferred) : nom, « Code : », « SIRET : », « Directrice : » (« Non renseignée »), « RO : » (« Aucune RO affectée »), pastille « Crèche vérifiée » / « Non vérifiée » ; carte sélectionnable (`aria-pressed`, clavier compris), la première choisie d'office. Directrice et RO ne voient que leurs crèches, les autres rôles toutes. Aucune création ni modification : le référentiel vient de la lecture Sheets. Vide : « Aucune crèche n'est visible pour votre compte. Contactez la RH. ».
- **Clôture mensuelle visible** (`rule-evp-closure-visible` user) : section « Clôture mensuelle · <crèche> », sélecteur « Mois de paie » (mois de paie courant, qui passe au mois suivant après le 25, et cinq précédents ; `rule-evp-closure-month-choice` inferred, `rule-evp-closure-payroll-month` user), pastille « Ouvert · N dossier(s) ouvert(s) » ou « Clôturé », « Clôturé le … par <nom>. ».
- **Dossiers ouverts bloquent** (`rule-evp-closure-open-blocks` user) : bandeau « La clôture est impossible : N dossier(s) ouvert(s) pour ce mois de paie, y compris ceux « à saisir ». » et lien « Voir les dossiers ouverts » vers `/declarations?creche=<code>&mois=AAAA-MM&ouvertes=1` ; case et bouton désactivés.
- **Attestation** (`rule-evp-closure-attest` user, `rule-evp-closure-api-roles` user) : seule la capacité `closures:attest` (directrice) voit la case « J'atteste avoir vérifié les absences de ce mois. » et « Clôturer le mois » / « Clôture en cours… » (un seul envoi) ; dialogue « Clôturer <mois> pour <crèche> ? » (« Vous attestez avoir vérifié les absences. Cette action est tracée au journal. ») ; succès « Le mois <mois> est clôturé pour <crèche>. ». Les autres rôles lisent « La clôture est attestée par la directrice de la crèche. » (l'API accepte aussi RO, RH et superadmin, jamais l'administratrice).
- **Échecs** : `closures.open_absences` (« Des dossiers sont encore ouverts pour ce mois : la clôture est impossible. », décompte relu), `closures.already_closed`, `400`, `403`. Un mois clôturé n'offre aucune action, aucune réouverture (`rule-evp-closure-no-reopen` inferred).

## Limites connues
- L'alerte d'erreur de clôture n'est rendue que dans la branche de l'utilisateur qui peut attester.
- Déclarer ou modifier un dossier dans un mois déjà clôturé n'est pas empêché (point à arbitrer).
- Aucun test de navigateur n'a été exécuté pour ce résumé.
