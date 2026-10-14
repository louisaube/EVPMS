# Écran Nouvelle absence (`/absences/nouvelle`) : plan de réalisation (v3)

Objet : le sélecteur « Salariée et contrat » ne propose plus que les contrats actifs et à venir de la société PayFit de la crèche, jamais les contrats archivés, pour que les salariées qui passent d'une crèche à l'autre n'y apparaissent plus plusieurs fois. Les crèches qui partagent un SIRET se déclarent comme les autres.

Le plan de la v1 (`../v1-evp/nouvelle-absence-page-implementation-plan.md`) reste la référence pour tout ce qui n'est pas dit ici. La demande à l'API est `creches-api-modification-request.md`.

## Parcours
Inchangé, avec ces compléments à l'étape 2 :
1. L'utilisateur choisit la crèche ; le champ « Salariée et contrat » liste les contrats actifs et à venir de la société PayFit liée au SIRET de la crèche. Une salariée dont l'ancien contrat est archivé et dont le nouveau est actif n'apparaît qu'une fois, avec le contrat actif.
2. Pour une crèche qui partage son SIRET avec une autre, la liste écarte les salariées vues au planning Aqoona de l'autre crèche seulement (decision D-0013) : une directrice de Bêta ne voit pas les salariées d'Alpha. Une salariée vue à aucun planning (ou Aqoona jamais lue) reste proposée aux deux crèches : elle n'est jamais invisible (précision du propriétaire) ; rien d'autre ne diffère dans le parcours.
3. Si la crèche n'a que des contrats archivés, la liste est vide et le message de liste vide s'affiche ; pour une crèche à SIRET partagé (`planningRestricted`), le message propre à ce cas s'affiche à la place.

## Éléments à l'écran
Éléments de la v1 conservés avec leurs libellés. Changements :

| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Champ salariée et contrat | « Salariée et contrat » (inchangé) ; options « <Prénom Nom> — contrat du jj/mm/aaaa au jj/mm/aaaa » (« en cours » sans fin), texte secondaire « Contrat PayFit : <identifiant> » (inchangés) ; aide **« Seuls les contrats actifs et à venir importés de PayFit sont proposés. »** (remplace « Seuls les contrats importés de PayFit sont proposés. ») | Recherche à partir de 3 caractères, 20 résultats au plus (inchangé) ; aucun contrat archivé n'est jamais listé | `GET /creches/{code}/contracts?search=` |
| Message de liste vide | **« Aucun contrat actif ou à venir importé pour cette crèche. Demandez une lecture PayFit à la RH. »** (remplace « Aucun contrat importé pour cette crèche. … ») | Affiché si aucun résultat sans recherche | idem |
| Message de liste vide, crèche à SIRET partagé | **« Aucun contrat actif ou à venir à proposer pour cette crèche. Elle partage son SIRET : les salariées vues au planning Aqoona d'une autre crèche du même SIRET ne lui sont pas proposées. »** (libellé choisi ici, decision D-0013 ; remplace le libellé « Aucune salariée de cette crèche n'apparaît dans le planning Aqoona lu… », devenu faux depuis la précision du propriétaire) | Affiché à la place du message précédent si aucun résultat sans recherche et si `planningRestricted` vaut `true` | `GET /creches/{code}/contracts` (`planningRestricted`) |
| Autres champs, messages d'erreur, enregistrement | inchangés | inchangés | inchangées |

Le studio ne filtre ni ne trie rien lui-même : il affiche ce que `GET /creches/{code}/contracts` renvoie. Le champ ne montre pas le statut du contrat (la date de début distingue deux contrats d'une même salariée).

## Règles
- `rule-evp-declare-contracts-not-archived` (user) : le sélecteur ne propose que les contrats actifs et à venir, jamais les archivés.
- `rule-evp-declare-contracts-list-only` (inferred) : seul ce que l'écran propose change ; un dossier existant sur un contrat archivé s'affiche comme avant (le détail d'une absence ne relit pas cette liste).
- `rule-evp-siret-shared-creches` (user) : deux crèches de même SIRET sont deux crèches distinctes à l'écran (« Crèche » les liste séparément).
- `rule-evp-siret-shared-contracts` (inferred, decision D-0013) : pour une crèche qui partage son SIRET, la liste écarte les contrats des salariées vues au planning Aqoona d'une autre crèche du SIRET seulement ; l'écran n'affiche rien d'autre qu'une liste plus courte, hormis le message de liste vide propre à ce cas. Le studio ne filtre rien lui-même : il lit `items` et `planningRestricted`.
- `rule-evp-siret-shared-contracts-visible` (user, précision du propriétaire) : une salariée ne peut être visible nulle part ; vue à aucun planning, elle est proposée à chaque crèche de son SIRET.
- `rule-evp-declare-employee-key` (user, inchangée) : la salariée est choisie par son contrat (société + contrat), pas par son nom seul. Une professionnelle à cheval sur plusieurs SIRET figure dans la liste de chaque crèche de ses sociétés, avec son contrat de la société concernée (`rule-evp-employee-multi-company`, user).
- `rule-evp-declare-validation-local` (inferred, inchangée) : crèche, contrat, type, dates obligatoires.
- Inchangées : `rule-evp-declare-steps`, `rule-evp-declare-checks`, `rule-evp-declare-result-status`, `rule-evp-declare-duplicate`, `rule-evp-declare-overlap-blocks`, `rule-evp-declare-roles`.

## Accès
Inchangé : directrice, RO, RH et superadmin déclarent pour les crèches de leur périmètre ; l'administratrice reçoit « Accès refusé ».

## Hypothèses
- « Actif » et « à venir » se lisent sur l'état du contrat tenu par la lecture PayFit (`ACTIVE`, `PENDING`), pas sur les dates ; une date de fin dépassée sur un contrat que PayFit dit encore actif ne le retire pas de la liste.
- La liste ne propose pas la déclaration sur un contrat archivé, même pour une absence passée d'une salariée partie : c'est le sens de la demande, et le contrôle « période hors contrat » du serveur reste inchangé pour les dossiers existants.
- Une salariée d'une crèche à SIRET partagé qui n'est dans aucun planning Aqoona lu (congé long, embauche récente, Aqoona jamais lue) est proposée à toutes les crèches du SIRET (« elle apparaît au minimum sur la crèche de son SIRET » : la crèche n'étant pas connue, toutes). Dès qu'un planning la place dans une crèche du SIRET, elle n'est plus proposée aux autres. Le contrôle du serveur à l'enregistrement reste celui de la société (`rule-evp-creche-contract-match`).
- Une salariée à cheval sur deux SIRET, absente le même jour des deux crèches, se déclare par un dossier par contrat choisi ; EVP ne crée pas seul le second dossier (pas de fonction inventée), la RH saisit dans chaque société.
- Aucun changement des écrans Détail d'une absence, Les déclarations, À faire, Les crèches : un SIRET partagé s'y affiche comme deux crèches ordinaires (la carte montre « SIRET : » pour chacune).
