# Écran Sources (`/sources`) : plan de réalisation

Objet : montrer l'état de chaque source (Google Workspace, Google Sheets « Contacts des crèches », PayFit, Aqoona), la dernière lecture, le volume, les anomalies, et lancer une actualisation manuelle. Les sources sont en lecture seule ; rien n'est écrit dans PayFit ni dans les autres sources. Réservé à RH (PayFit, Aqoona) et au superadmin (toutes les sources).

## Parcours
1. L'utilisateur ouvre « Sources ». Attente pendant `GET /sources`.
2. Une carte par source visible : état, dernière lecture, fenêtre, volumes, nombre d'anomalies, bouton d'actualisation si permis.
3. Clic sur « Actualiser » : confirmation courte, puis lancement (`202`) ; la carte passe à « Lecture en cours… » et l'écran relit `GET /sources/runs/{id}` toutes les 2 s jusqu'à la fin.
4. Superadmin : « Actualiser toutes les sources » enchaîne dans l'ordre Contacts des crèches, PayFit, Aqoona ; l'avancement s'affiche étape par étape.
5. « Voir les anomalies » ouvre le panneau des anomalies de la source (paginé).
6. Fin de lecture : cartes relues, notification « Lecture terminée. » ou erreur « La lecture a échoué. Consultez les anomalies et réessayez. ».

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Sources » (`h1`) | — | — |
| Avertissement | « Les sources sont en lecture seule : EVP les contrôle puis les copie. Aucune écriture dans PayFit ni dans les autres sources. » | Note fixe | — |
| Bouton global | « Actualiser toutes les sources » | Visible pour la capacité `sources:refresh:sheets` (superadmin) ; ordre Contacts des crèches, PayFit, Aqoona ; désactivé pendant une lecture | `POST /sources/refresh-all` |
| Carte « Google Workspace » | titre « Google Workspace », sous-titre « Identité de connexion » | État « Disponible » / « Indisponible » ; pas de lecture ni de bouton d'actualisation ; texte « Adresse vérifiée, domaine et profil seulement : aucun accès à Gmail, à l'agenda ni au Drive personnel. » | `GET /sources` |
| Carte « Contacts des crèches » | titre « Google Sheets : Contacts des crèches » | Référentiel des crèches ; bouton « Actualiser » pour le superadmin seulement | idem |
| Carte « PayFit » | titre « PayFit » | Fenêtre « du jj/mm/aaaa au jj/mm/aaaa » (début de M−2 à fin de M+2) ; bouton « Actualiser » pour RH et superadmin | idem |
| Carte « Aqoona » | titre « Aqoona » | Fenêtre « du jj/mm/aaaa au jj/mm/aaaa » (J−28 à J+35) ; bouton « Actualiser » pour RH et superadmin | idem |
| État d'une source | « Jamais lue », « À jour », « Lecture en cours… », « En erreur », « Indisponible » (texte + icône) | — | `state` |
| Dernière lecture | « Dernière lecture : jj/mm/aaaa à hh:mm » ou « Jamais lue » | — | `lastReadAt` |
| Volumes | liste « libellé : nombre » (ex. PayFit : « Collaboratrices : 412 », « Contrats : 455 », « Absences : 1 203 » ; Aqoona : « Créneaux de planning : 8 540 », « Lignes non rattachées : 12 » ; Contacts : « Crèches : 38 ») | Nombres au format français | `volumes` |
| Anomalies | « N anomalie(s) » + bouton « Voir les anomalies de <source> » | « Aucune anomalie » à 0 | `anomalyCount` |
| Bouton « Actualiser » | « Actualiser PayFit », « Actualiser Aqoona », « Actualiser Contacts des crèches » | Ouvre « Lancer la lecture de <source> ? La lecture est en lecture seule et n'écrit rien dans la source. » ; « Annuler » / « Lancer la lecture » ; un seul envoi | `POST /sources/{key}/refresh` |
| Progression | « Lecture en cours… » + barre indéterminée ; en lot : « Étape 2 sur 3 : PayFit » | `role="status"` ; polling 2 s, arrêt au changement de page | `GET /sources/runs/{id}` |
| Panneau d'anomalies | tableau « Type », « Élément concerné », « Détail » ; pagination 10 / 25 / 50 | Libellés français de l'API ; jamais de matricule, de NIR ni de donnée médicale | `GET /sources/{key}/anomalies` |
| Types d'anomalies affichés | Contacts : « Écart RO » (signalé, non écrasé), « Directrice inconnue », « SIRET manquant ou invalide », « RO retirée présente dans le tableau » ; PayFit : « Société sans crèche (SIRET) », « Contrat sans société », « Absence sans contrat » ; Aqoona : « Crèche non appariée », « Personne non appariée », « Correspondance ambiguë », « Matricule écarté » | Libellé issu de l'API (`label`) | idem |
| Conflit | « Une lecture est déjà en cours. » | `409 sources.run_in_progress` | — |
| Vide | « Aucune source à afficher. » | Cas improbable | — |

## Règles
- `rule-evp-sources-readonly` (user) : les sources sont en lecture seule, contrôlées puis copiées dans EVP ; aucun envoi, aucune écriture dans PayFit ni les sources.
- `rule-evp-sources-screen` (user) : l'écran montre l'état de chaque source, la dernière lecture, le volume, les anomalies et le choix d'une actualisation.
- `rule-evp-sources-sheets-superadmin` (user) : la lecture du Google Sheets est lancée par le superadmin uniquement, avant PayFit et Aqoona dans « Toutes les sources ».
- `rule-evp-sources-payfit-aqoona-manual` (user) : PayFit et Aqoona sont déclenchés manuellement par RH et superadmin ; aucun ordonnanceur ni lecture automatique.
- `rule-evp-sources-windows` (user) : fenêtre PayFit du début de M−2 à la fin de M+2 ; fenêtre Aqoona de J−28 à J+35.
- `rule-evp-sources-no-invention` (user) : sans correspondance certaine, pas d'invention : exclusion ou ligne non rattachée, et anomalie visible dans l'écran Sources.
- `rule-evp-sources-nir-discarded` (user) : un matricule ressemblant à un NIR est écarté ; l'écran n'affiche que le décompte et le type « Matricule écarté », jamais la valeur.
- `rule-evp-sources-workspace-scope` (user) : Google Workspace ne fournit que l'identité de connexion ; l'écran le dit.
- `rule-evp-sources-no-auto-absence` (user) : la production automatique de signaux d'absence depuis Aqoona n'est pas demandée ; aucun bouton ni aucune alerte n'en crée.
- `rule-evp-sources-ro-gaps-not-overwritten` (user) : les écarts RO du tableau source sont signalés comme anomalies sans écraser les choix administrés.
- `rule-evp-sources-run-polling` (inferred) : l'écran suit une lecture par `GET /sources/runs/{id}` toutes les 2 s tant que son état est « en cours ».
- `rule-evp-sources-guard` (inferred) : sans la capacité `sources:read`, « Accès refusé ».
- `rule-evp-sources-refresh-audited` (inferred) : chaque lecture lancée est journalisée.

## Accès
RH : cartes PayFit et Aqoona (et état de Workspace et Contacts en lecture), actualisation PayFit et Aqoona. Superadmin : toutes les cartes, toutes les actualisations, « Actualiser toutes les sources ». Directrice, RO, administratrice : « Accès refusé ».

## Hypothèses
- La lecture est asynchrone (`202` puis suivi) car elle peut durer ; la demande ne précise pas la durée.
- La carte Google Workspace n'a pas d'actualisation : c'est l'identité de connexion, pas une source copiée.
- RH voit l'état des quatre sources mais ne peut lancer que PayFit et Aqoona ; les anomalies des Contacts des crèches lui sont lisibles (hypothèse : « toutes les sources » ne concerne que le superadmin pour le lancement).
- Les libellés des types d'anomalies sont inférés des liens décrits (SIRET, contrat, nom de crèche normalisé, nom et prénom).
- Aucun détail d'anomalie ne montre de donnée de santé ou d'identifiant national.
