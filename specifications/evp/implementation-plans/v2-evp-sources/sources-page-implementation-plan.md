# Écran Sources (`/sources`) : plan de réalisation (v2)

Objet : montrer l'état réel de chaque source (Google Workspace, Google Sheets « Contacts des crèches », PayFit, Aqoona), la dernière lecture, le volume, les anomalies, et lancer une actualisation manuelle. En v2 les lectures sont réelles : une source injoignable, refusée ou non configurée affiche sa cause en français, sans donnée inventée et sans jamais exposer un secret. Réservé à RH (PayFit, Aqoona) et au superadmin (toutes les sources).

Le plan de la v1 (`../v1-evp/sources-page-implementation-plan.md`) reste la référence pour tout ce qui n'est pas dit ici (parcours, confirmation, polling, panneau d'anomalies, chaînage « toutes les sources »).

## Parcours
Inchangé, avec ces compléments :
1. Une carte par source. Une source dont la lecture a échoué montre « En erreur » et, sous l'état, la cause : « Dernière tentative en échec le jj/mm/aaaa à hh:mm : <message> ». Les volumes et la date de « Dernière lecture » restent ceux du dernier succès.
2. Une source non configurée montre « Indisponible » et le message « Source non configurée : <ce qui manque, en mots, sans valeur> » ; son bouton « Actualiser » reste disponible (la lecture se termine alors en erreur et le dit).
3. Fin d'une lecture en échec : notification « La lecture a échoué. Consultez les anomalies et réessayez. » (inchangée) ; l'écran relit `GET /sources` et affiche la cause.
4. « Toutes les sources » : la première lecture en échec arrête l'enchaînement ; la carte en échec montre sa cause, les suivantes restent « Jamais lue » ou à leur état précédent.
5. Carte Aqoona : la ou les adresses lues sont listées sous la forme masquée.
6. Une lecture partielle (une société PayFit ou une adresse Aqoona en échec, les autres copiées) s'affiche « Lecture partielle » (decision D-0007, voir plus bas) ; la date de « Dernière lecture » est celle de cette lecture.

## Éléments à l'écran
Les éléments de la v1 sont conservés avec leurs libellés. Changements et ajouts :

| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Carte « Google Workspace » | « Google Workspace » / « Identité de connexion » | État « Disponible » si la connexion Google est configurée, « Indisponible » sinon ; texte inchangé « Adresse vérifiée, domaine et profil seulement : aucun accès à Gmail, à l'agenda ni au Drive. » ; pas de bouton | `GET /sources` (`state`) |
| État d'une source | « Jamais lue », « À jour », « Lecture en cours… », « En erreur », « Indisponible », « Lecture partielle » (texte + icône, pas la couleur seule) | « Indisponible » = non configurée ; « En erreur » = dernière lecture échouée ; « Lecture partielle » = lecture réussie pour une partie des sociétés ou adresses | `state` |
| Cause de l'échec | « Dernière tentative en échec le jj/mm/aaaa à hh:mm : <message> » | `role="status"` ; visible seulement si `lastError` non nul ; message en français fourni par l'API, jamais construit par le studio | `lastError` |
| Messages de cause (texte de l'API) | « Source non configurée », « Source injoignable », « Accès refusé par la source », « Source momentanément saturée, réessayez plus tard », « Réponse de la source inattendue » | Un par code `sources.not_configured`, `sources.unreachable`, `sources.refused`, `sources.rate_limited`, `sources.unexpected_format`, éventuellement précisés par l'API (« Clé refusée pour une société », « Portée PayFit manquante », « Adresse Aqoona refusée ») | `lastError.message` |
| Adresses Aqoona | « Adresse lue : <libellé> : https://hôte/chemin?… » (une ligne par adresse) | Texte non cliquable ; la partie après `?` est toujours remplacée par `…` ; aucun lien, aucun bouton de copie | `addresses` |
| Dernière lecture | « Dernière lecture : jj/mm/aaaa à hh:mm » ou « Jamais lue » | Date du dernier succès, conservée après un échec | `lastReadAt` |
| Types d'anomalies PayFit ajoutés | « SIRET différent de la clé », « Type d'absence PayFit non configuré », « Demi-journée PayFit non interprétable », « Société inaccessible » | Affichés dans le panneau avec « Type », « Élément concerné », « Détail » ; `Élément concerné` = code de type ou nom de société, jamais de clé | `GET /sources/payfit/anomalies` |
| Types d'anomalies Aqoona ajoutés | « Ligne Aqoona inexploitable », « Adresse Aqoona inaccessible » | idem, avec un décompte dans « Détail » pour la première ; le sujet de la seconde est le libellé de l'adresse, jamais l'adresse | `GET /sources/aqoona/anomalies` |
| Types d'anomalies Sheets ajoutés | aucun | — | — |
| État « Lecture partielle » (decision D-0007) | « Lecture partielle » + anomalie « Société inaccessible » (PayFit) ou « Adresse Aqoona inaccessible » (Aqoona) | Texte + icône ; le panneau d'anomalies dit quelles sociétés ou adresses n'ont pas été relues (leurs données précédentes sont conservées) ; aucune cause d'échec « Dernière tentative en échec… » n'est affichée, `lastError` étant nul | `state = PARTIAL`, `GET /sources/{key}/anomalies` |
| Message d'une lecture en cours dans la boîte de confirmation | « Lancer la lecture de <source> ? La lecture est en lecture seule et n'écrit rien dans la source. » | Inchangé | — |

## Réalisation (studio)
Un seul fichier existant change : `studio/src/app/features/sources/pages/SourcesPage.tsx` (aucune page, route ni composant nouveau). Les types viennent de `@evpms/api-client` après `pnpm api-client:generate` à la suite du redémarrage de l'API ; aucun type local ne duplique `lastError` ni `addresses`.
- `STATE_LABEL` gagne `PARTIAL: 'Lecture partielle'` avec une icône propre (avertissement) ; le `StateChip` de la carte Workspace garde sa règle actuelle (« Disponible » sauf `UNAVAILABLE` et `ERROR`), ce qui convient à `UP_TO_DATE` (configurée) et `UNAVAILABLE` (non configurée).
- La cause d'échec s'affiche sous l'état quand `lastError` est non nul : « Dernière tentative en échec le <date de lastError.at> : <lastError.message> » (`role="status"`, heure de Paris).
- Adresses Aqoona : une ligne « Adresse lue : <label> : <masked> » par élément de `addresses` ; par prudence le studio coupe `masked` au premier `?` et ajoute `?…` avant d'afficher, de sorte qu'une valeur mal masquée par l'API ne s'affiche jamais ; rien n'est cliquable.
- Fin de lecture : la notification d'échec existante est conservée ; pour une lecture terminée dont l'état relu est `PARTIAL`, notification d'avertissement « La lecture est partielle. Consultez les anomalies. » (texte ajouté, inferred, decision D-0007).
- Les nouveaux types d'anomalie n'exigent aucun code : le panneau affiche `label`, `subject`, `detail` fournis par l'API.

## Règles
- `rule-evp-sources-screen` (user) : l'écran montre l'état de chaque source, la dernière lecture, le volume, les anomalies et le choix d'une actualisation.
- `rule-evp-sources-failure-state` (user) : une source injoignable (en totalité) ou refusée affiche son état, sans donnée inventée : volumes et « Dernière lecture » restent ceux du dernier succès, aucun chiffre n'est calculé ni estimé par le studio.
- `rule-evp-secrets-never-exposed` (user) : le studio n'affiche aucun secret : ni clé, ni adresse complète, ni message technique, ni code HTTP brut de la source ; le texte d'erreur est celui de l'API.
- `rule-evp-aqoona-mask` (user) : une adresse Aqoona n'est jamais montrée avec la partie qui suit le `?`.
- `rule-evp-sources-readonly` (user) : l'avertissement « Les sources sont en lecture seule… » reste affiché ; aucune action d'écriture n'existe à l'écran.
- `rule-evp-sources-manual` (user) : seule une action humaine lance une lecture ; l'écran n'en déclenche aucune seul et son suivi (polling toutes les 2 s) s'arrête à la fin ou au changement de page.
- `rule-evp-sources-sheets-superadmin` (user, inchangé) : « Actualiser Contacts des crèches » et « Actualiser toutes les sources » pour le superadmin seul, Sheets en premier.
- `rule-evp-sources-payfit-aqoona-manual` (user, inchangé) : « Actualiser PayFit » et « Actualiser Aqoona » pour RH et superadmin.
- `rule-evp-sources-windows` (user, inchangé) : « du jj/mm/aaaa au jj/mm/aaaa », M−2 à M+2 pour PayFit, J−28 à J+35 pour Aqoona.
- `rule-evp-sources-no-invention` (user, inchangé) : sans correspondance certaine, ligne non rattachée et anomalie visible.
- `rule-evp-sources-nir-discarded` (user, inchangé) : seul le décompte « Matricule écarté » est montré.
- `rule-evp-sources-ro-gaps-not-overwritten` (user, inchangé) : « Écart RO » signalé, jamais appliqué.
- `rule-evp-sources-no-auto-absence` (user, inchangé) : aucun bouton ni alerte de création d'absence depuis Aqoona.
- `rule-evp-sources-workspace-scope` (user, inchangé) : le texte de la carte Workspace.
- `rule-evp-sources-partial-failure` (inferred, decision D-0007) : une clé ou une adresse en échec n'empêche pas de copier les autres ; l'écran montre « Lecture partielle » et, dans le panneau d'anomalies, « Société inaccessible » (détail « Clé refusée pour une société », sans nom de clé ni secret) ou « Adresse Aqoona inaccessible ». Si toutes échouent, l'écran montre « En erreur » (`rule-evp-sources-failure-state`).
- `rule-evp-payfit-half-day-mapping` (inferred, decision D-0006) : l'écran affiche l'anomalie « Demi-journée PayFit non interprétable » pour les combinaisons que la correspondance ne traite pas.
- `rule-evp-sources-guard` (inferred, inchangé) : sans la capacité `sources:read`, « Accès refusé ».
- `rule-evp-sources-run-polling` (inferred, inchangé) : polling de `GET /sources/runs/{id}` toutes les 2 s tant que l'état est « en cours ».
- `rule-evp-sources-refresh-audited` (inferred, inchangé).

## Accès
Inchangé. RH : lecture des quatre cartes, actualisation PayFit et Aqoona ; superadmin : tout, dont « Actualiser toutes les sources » ; directrice, RO, administratrice : « Accès refusé ». L'adresse masquée d'Aqoona n'est visible que par les rôles qui voient l'écran.

## Hypothèses
- `GET /sources` fournit `lastError` et `addresses` (voir `sources-api-modification-request.md`) ; la forme exacte du texte « Dernière tentative en échec… » est de l'écran, le message vient de l'API.
- La carte Workspace affiche « Disponible » quand la connexion Google est configurée, sans sonder Google : aucune lecture n'est lancée sans action humaine.
- Une source non configurée reste actualisable : le clic aboutit à une erreur explicite plutôt qu'à un bouton désactivé sans explication.
- Le libellé de l'adresse Aqoona (« libellé ») est une étiquette de configuration non secrète (par exemple le nom de la société) ; si aucune n'est fournie, « Adresse 1 », « Adresse 2 ».
- L'option B de Q-EVP-04, choisie par le propriétaire (decision D-0007), ajoute l'état « Lecture partielle » et les anomalies « Société inaccessible » et « Adresse Aqoona inaccessible ».
- Les écrans Détail d'une absence, Notifications, Les crèches et Accès ne changent pas de libellés : les données lues réellement alimentent les mêmes champs. La colonne « Code PayFit » de Paramètres affiche le premier code configuré du type d'absence ; l'écran Paramètres n'est donc pas modifié.
