# Export paie (`/export-paie`) : état réalisé

Téléchargement d'un CSV des absences qui chevauchent une période. Code : `studio/src/app/features/exports/pages/ExportPaiePage.tsx` ; API : `features/exports/` (`POST /exports/absences`). Plan : `v1-evp/export-paie-page-implementation-plan.md`.

## Ce qui existe
- **Réservé à RH et au superadmin** (`rule-evp-export-roles` user) : route sous `RequireCapability("export:run")` ; l'API répond `403` aux autres.
- **Période** (`rule-evp-export-period` user, `rule-evp-export-max-span` inferred) : « Date de début de la période » et « Date de fin de la période » obligatoires ; « La date de fin doit suivre la date de début. » si inversées, « La période ne peut pas dépasser 366 jours. » au-delà ; le bouton se désactive dans ces cas et sans date. Raccourcis « Mois précédent » et « Mois en cours » (premier au dernier jour du mois, heure de Paris). Aucun appel à l'ouverture.
- **Explication fixe** (`rule-evp-export-columns` user, `rule-evp-export-audited` user, `rule-evp-export-no-payfit-write` user) : le fichier contient toute absence qui chevauche la période (crèche, salariée, contrat, type, code PayFit, dates, demi-journées, statut, motif administratif), ne transmet rien à PayFit et est enregistré au journal ; rappel « Fichier CSV encodé en UTF-8, séparateur point-virgule, ouvrable dans Excel. » (`rule-evp-export-csv-format` inferred, `rule-evp-export-all-statuses` inferred).
- **Téléchargement** (`rule-evp-export-post-for-audit` inferred) : « Télécharger le CSV » / « Génération du fichier… », un seul envoi ; `fetch` en `POST` avec le cookie de session, réponse lue en `blob` et enregistrée par un lien temporaire local révoqué ensuite, nom pris de `Content-Disposition` (repli `absences-AAAA-MM-JJ_AAAA-MM-JJ.csv`) ; le fichier n'est conservé nulle part (`rule-evp-export-no-file-kept` inferred).
- **Messages** : succès « Export téléchargé. Il est enregistré au journal. » (`role="status"`), complété par « Aucune absence ne chevauche cette période : le fichier ne contient que les en-têtes. » si le fichier n'a qu'une ligne ; `400` « Données invalides. Vérifiez les champs. », `403` « Action non autorisée. », autres « L'export a échoué. Veuillez réessayer. » ; `401` met fin à la session ; dates conservées en cas d'échec.

## Limites connues
- La page ne décode pas le CSV et ne vérifie pas ses colonnes ; elles sont produites et testées côté API (`acceptance-evp-notifications-journal-export.test.ts`).
- L'appel passe par `fetch` natif, hors client typé, parce que la réponse n'est pas du JSON.
- Aucun test de navigateur n'a été exécuté pour ce résumé.
