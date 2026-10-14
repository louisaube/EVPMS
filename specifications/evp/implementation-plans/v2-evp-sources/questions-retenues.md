# Questions retenues pour v2-evp-sources

8 questions produites ; 5 retenues pour le propriétaire ; 3 tranchées par défaut et inscrites au registre.

### 1. Q-EVP-01 : Comment le navigateur remet le jeton d'identité Google au serveur

Situation : Une personne du domaine micro-stars.fr, inscrite et active, clique sur « Se connecter avec Google » sur /connexion ; le serveur reçoit un jeton d'identité dont la signature a été altérée.

- **A (défaut). Redirection serveur avec code d'autorisation (flux déjà en place), le serveur échange le code et vérifie le jeton reçu de Google.** Aucune session n'est ouverte ; la personne revient sur /connexion?erreur=echec. Le studio ne contient aucun identifiant Google ; la protection contre la falsification de requête repose sur `state`, `nonce` et PKCE. Coût : leger.
- **B. Bouton « Se connecter avec Google » (Google Identity Services) qui envoie le jeton en POST au serveur, avec contrôle CSRF `g_csrf_token`.** Aucune session n'est ouverte ; la personne revient sur /connexion?erreur=echec. Un POST dont le `g_csrf_token` du cookie diffère de celui du corps est refusé de la même façon. Coût : lourd. Questions ouvertes : identifiant client Google public dans le studio, nouvelle route POST /google-sign-in/credential à déclarer, origine autorisée côté Google Cloud, retrait des routes start et callback.

### 2. Q-EVP-02 : Correspondance des demi-journées PayFit (moment) avec le matin et l'après-midi d'EVP

Situation : Un dossier « À saisir » commence l'après-midi (début APRES_MIDI) et finit le soir (fin APRES_MIDI) ; PayFit renvoie la même absence, approuvée, avec startDate.moment = middle-of-day et endDate.moment = end-of-day.

- **A (défaut). Lecture selon la position. Début : beginning-of-day = matin, middle-of-day = après-midi. Fin : middle-of-day = matin, end-of-day = après-midi. Toute autre combinaison est non interprétable.** Le dossier passe à « Présente dans PayFit ». Une absence PayFit dont le début vaut end-of-day (ou la fin beginning-of-day) n'est jamais confirmée : anomalie « Demi-journée PayFit non interprétable ». Coût : leger.
- **B. Lecture littérale, indépendante de la position. beginning-of-day = matin, end-of-day = après-midi, middle-of-day jamais interprété.** Le dossier reste « À saisir » avec le blocage « à vérifier » et l'anomalie « Demi-journée PayFit non interprétable » : toute demi-journée de départ à midi doit être traitée à la main par la RH. Coût : leger.

### 3. Q-EVP-04 : Une clé PayFit ou une adresse Aqoona échoue alors que les autres répondent

Situation : Deux sociétés ont chacune une clé PayFit ; la première répond, la seconde est refusée (401). Même cas avec deux adresses Aqoona dont l'une échoue.

- **A (défaut). Tout ou rien. La lecture entière échoue et rien n'est copié.** La lecture passe à « En erreur » avec le message « Clé refusée pour une société » (aucun nom de clé, aucun secret) ; les données du dernier succès sont conservées et aucune alerte de disparition n'est produite. Coût : leger.
- **B. Lecture partielle. Les sociétés qui répondent sont copiées, la société en échec est signalée.** La société 1 est copiée et sa couverture est exhaustive ; la société 2 garde ses données précédentes, sans alerte de disparition, avec l'anomalie « Société inaccessible » ; la source affiche « Lecture partielle ». Coût : lourd. Questions ouvertes : nouvel état « Lecture partielle » de la source, anomalie « Société inaccessible » par société, couverture non exhaustive par société pour les alertes de disparition.

### 4. Q-EVP-05 : Compte déjà lié à un identifiant Google (sub) qui se présente avec un autre sub

Situation : Le compte de Camille est inscrit avec l'adresse camille@micro-stars.fr et déjà lié à un sub S1 ; un jeton valide du domaine, e-mail vérifié, arrive avec la même adresse mais un sub S2 (compte Google recréé, ou usurpation d'une adresse recyclée).

- **A (défaut). Refus. Le compte reste lié à S1 ; le déblocage se fait hors application.** Connexion refusée avec le message commun « Ce compte n'est pas autorisé à utiliser EVP. » ; la liaison n'est pas modifiée, la personne doit passer par un correctif en base. Coût : leger.
- **B. Refus, avec un bouton « Réinitialiser la liaison Google » pour la RH et le superadmin.** Même refus d'abord. Après réinitialisation par un gestionnaire, la première connexion valide suivante lie le nouveau sub. Coût : lourd. Questions ouvertes : route POST /access-accounts/{id}/reset-google-link à déclarer, capacité à choisir, entrée de journal, bouton sur l'écran Accès, comptes gérables seulement.

### 5. Q-EVP-07 : Identité utilisée pour lire le tableau des crèches (Google Sheets)

Situation : Le classeur des crèches est partagé en lecture ; l'application doit présenter une identité à Google pour lire l'onglet « Contacts des crèches ».

- **A (défaut). Compte de service (adresse e-mail et clé privée), flux JWT-bearer.** L'application obtient un jeton en signant une assertion avec la clé privée du compte de service, que l'on partage en lecture sur le classeur. Aucune personne n'est impliquée, rien n'expire. Coût : leger.
- **B. Jeton de renouvellement OAuth d'un compte Google de personne (client OAuth de l'application).** L'application lit le classeur avec les droits d'une personne ; la lecture échoue (source refusée) si le consentement est révoqué. Coût : lourd. Questions ouvertes : qui consent et avec quel compte, révocation si la personne quitte l'entreprise ou change de mot de passe, stockage du jeton de renouvellement, écran de consentement Google Cloud.

Répondre dans l'ordre : `cuisine arbitre "?/?/?/?/?"` ou `cuisine arbitre defaut`.
