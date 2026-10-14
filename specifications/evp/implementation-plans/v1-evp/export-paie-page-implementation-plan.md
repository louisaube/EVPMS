# Écran Export paie (`/export-paie`) : plan de réalisation

Objet : permettre à RH et au superadmin de télécharger un fichier CSV des absences chevauchant une période. L'export est journalisé ; il ne déclenche ni import ni écriture dans PayFit.

## Parcours
1. L'utilisateur ouvre « Export paie ». Aucun appel à l'ouverture.
2. Il choisit une date de début et une date de fin.
3. « Télécharger le CSV » : contrôle local des dates, puis `POST /exports/absences`. Pendant la génération : « Génération du fichier… ».
4. Succès : le navigateur télécharge le fichier `absences-AAAA-MM-JJ_AAAA-MM-JJ.csv` ; message « Export téléchargé. Il est enregistré au journal. ».
5. Échec : alerte au-dessus du bouton, dates conservées.
6. Période sans absence : le fichier ne contient que l'en-tête et le message le dit (« Aucune absence ne chevauche cette période : le fichier ne contient que les en-têtes. »).

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Export paie » (`h1`) | — | — |
| Explication | « Le fichier contient toute absence qui chevauche la période choisie : crèche, salariée, contrat, type, code PayFit, dates, demi-journées, statut et motif administratif. L'export ne transmet rien à PayFit et il est enregistré au journal. » | Texte fixe | — |
| Champ début | « Date de début de la période » (date native, obligatoire) | — | — |
| Champ fin | « Date de fin de la période » (date native, obligatoire) | ≥ date de début ; sinon « La date de fin doit suivre la date de début. » et aucun appel | — |
| Raccourcis | « Mois précédent » et « Mois en cours » | Remplissent les deux dates (1er au dernier jour du mois, fuseau Europe/Paris) | — |
| Bouton | « Télécharger le CSV » ; « Génération du fichier… » pendant l'envoi | Désactivé si une date manque ou si la période dépasse 366 jours (« La période ne peut pas dépasser 366 jours. ») ; un seul envoi ; la réponse CSV est lue en `blob` puis enregistrée via un lien temporaire local (`URL.createObjectURL`, révoqué ensuite) | `POST /exports/absences` |
| Rappel du format | « Fichier CSV encodé en UTF-8, séparateur point-virgule, ouvrable dans Excel. » | Texte fixe | — |
| Succès | « Export téléchargé. Il est enregistré au journal. » | `role="status"` | — |
| Alertes | voir tableau | `role="alert"` | — |

### Colonnes du fichier (rappel, produites par l'API)
« Crèche », « Salariée », « Contrat », « Type », « Code PayFit », « Début », « Demi-journée de début », « Fin », « Demi-journée de fin », « Statut », « Motif administratif ».

### Échecs
| Réponse | Message |
|---|---|
| `400` | « Données invalides. Vérifiez les champs. » |
| `403` | « Action non autorisée. » |
| autres | « L'export a échoué. Veuillez réessayer. » |

## Règles
- `rule-evp-export-roles` (user) : l'export est réservé à RH et au superadmin.
- `rule-evp-export-period` (user) : l'utilisateur choisit une période ; toute absence qui la chevauche est incluse.
- `rule-evp-export-columns` (user) : crèche, salariée, contrat, type, code PayFit, dates, demi-journées, statut, motif administratif.
- `rule-evp-export-audited` (user) : l'export est journalisé ; l'écran le rappelle.
- `rule-evp-export-no-payfit-write` (user) : l'export ne déclenche ni import ni écriture dans PayFit ; l'écran le rappelle.
- `rule-evp-export-post-for-audit` (inferred) : l'export est un `POST` (le socle ne trace que les écritures) ; il ne modifie aucune donnée métier.
- `rule-evp-export-max-span` (inferred) : période de 366 jours au plus, bornée dans le contrat.
- `rule-evp-export-csv-format` (inferred) : UTF-8 avec BOM, séparateur `;`, dates `AAAA-MM-JJ`, demi-journées `MATIN` / `APRES_MIDI`.
- `rule-evp-export-all-statuses` (inferred) : tous les statuts sont exportés (la colonne « Statut » les distingue).
- `rule-evp-export-no-file-kept` (inferred) : le studio ne garde le fichier ni en mémoire persistante ni en cache.

## Accès
RH et superadmin (capacité `export:run`). Directrice, RO, administratrice : « Accès refusé » ; l'API répond `403`.

## Hypothèses
- La demande ne dit ni la borne de période, ni le séparateur, ni les statuts inclus ; choix inférés pour un usage Excel en France.
- Les raccourcis « Mois précédent » / « Mois en cours » sont une commodité non demandée.
- La réponse CSV n'est pas du JSON : l'appel passe par `fetch` avec les mêmes en-têtes que le client typé (cookie de session), `useCall` ne pouvant pas décoder un corps `text/csv` ; les échecs `401` terminent la session comme ailleurs.
- Le nom du fichier est proposé par l'en-tête `Content-Disposition` de l'API ; le studio a un nom de repli identique.
- Le fichier peut contenir des noms de salariées : il est généré à la demande, jamais conservé côté studio. Le motif administratif ne contient aucun détail médical (garanti à la saisie).
