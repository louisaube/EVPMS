# Questions retenues pour v3-evp-acces-contrats-siret

5 questions produites ; 4 retenues pour le propriétaire ; 1 tranchées par défaut et inscrites au registre.

### 1. Q-EVP-11 : Session déjà ouverte au moment où l'accès est délié de son compte Google

Situation : Camille est connectée (session de 8 h) avec son ancien compte Google. Marine délie l'accès de Camille de ce compte depuis l'écran Accès, puis Camille envoie une nouvelle requête avec sa session.

- **A (défaut). La session ouverte reste valide jusqu'à ses 8 heures ; seule la connexion suivante est concernée.** Camille continue de travailler jusqu'à l'expiration de sa session ; l'ancien compte Google ne peut plus ouvrir de nouvelle session. Coût : leger.
- **B. La session ouverte est coupée au moment où l'accès est délié.** La requête suivante de Camille est refusée ; elle doit se reconnecter, et la connexion suivante lie son compte Google actuel. Coût : lourd. Questions ouvertes : version de session par compte, effet d'un changement d'adresse ou d'un retrait sur les sessions ouvertes, migration.

### 2. Q-EVP-09 : Qui corrige la liaison Google d'un compte privilégié (RH, administratrice, superadmin)

Situation : Le compte Google de Marine (RH) a été recréé : sa connexion est refusée et son accès est encore lié à l'ancien compte Google. Louis (superadmin) ouvre l'écran Accès pour la dépanner.

- **A (défaut). Non, comme aujourd'hui les comptes privilégiés ne se gèrent pas depuis l'écran Accès ; le déblocage se fait hors application.** Louis ne voit pas Marine dans la liste ; délier son accès ou en changer l'adresse est refusé par l'API. Elle reste bloquée jusqu'à une correction en base. Coût : leger.
- **B. Le superadmin seul peut changer l'adresse et délier l'accès des comptes RH et administratrice (jamais le sien).** Louis voit Marine dans la liste, délie son accès : sa connexion suivante relie son nouveau compte Google. Les autres champs de son compte restent non modifiables. Coût : lourd. Questions ouvertes : affichage des comptes privilégiés dans la liste du superadmin seul, filtre « Rôle » élargi, actions limitées à « Modifier l'adresse » et « Délier le compte Google », règle rule-evp-access-no-privileged à rouvrir, protection du dernier superadmin.

### 3. Q-EVP-10 : Contrats proposés aux crèches qui partagent un même SIRET

Situation : Les crèches Alpha et Bêta portent le même SIRET, donc la même société PayFit. Camille a un contrat actif dans cette société ; le planning Aqoona ne la montre qu'à Alpha. Une directrice de Bêta ouvre « Nouvelle absence » et cherche Camille.

- **A (défaut). Tous les contrats actifs et à venir de la société sont proposés à chacune des crèches qui partagent le SIRET.** Camille est proposée à Bêta : la directrice de Bêta voit aussi les noms des salariées d'Alpha, la société PayFit ne distinguant pas les crèches. Coût : leger.
- **B. Pour les crèches qui partagent un SIRET, seuls les contrats des salariées vues dans le planning Aqoona de la crèche (fenêtre de la dernière lecture) sont proposés.** Camille n'est pas proposée à Bêta, seulement à Alpha. Une salariée absente de tout planning n'est proposée à aucune des deux crèches. Coût : lourd. Questions ouvertes : conduite quand Aqoona n'a jamais été lue, salariée absente du planning (congé long, embauche récente), message de liste vide propre à ce cas.

### 4. Q-EVP-12 : NIR d'Aqoona porté par plusieurs collaboratrices de la même société PayFit

Situation : Une ligne Aqoona « Pros » porte un NIR que deux collaboratrices de la société de la crèche portent aussi dans PayFit (fiche en doublon). Le prénom et le nom d'Aqoona désignent sans ambiguïté l'une des deux.

- **A (défaut). Ne rien rattacher et signaler « Rattachement par NIR ambigu », sans retomber sur les noms.** Le créneau est stocké sans collaboratrice ; l'anomalie « Planning non rattaché » porte le détail « Rattachement par NIR ambigu ». Coût : leger.
- **B. Retomber sur le prénom et le nom comme pour un NIR sans correspondance.** Le créneau est rattaché à la collaboratrice désignée par les noms, sans anomalie. Coût : leger. Questions ouvertes : une fiche en doublon dans PayFit passe inaperçue, la désignation par les noms peut contredire le NIR.

Répondre dans l'ordre : `cuisine arbitre "?/?/?/?"` ou `cuisine arbitre defaut`.
