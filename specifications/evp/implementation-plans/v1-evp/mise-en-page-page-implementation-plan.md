# Écran Mise en page commune (thème, navigation, PWA, états, vocabulaire) : plan de réalisation

Objet : cadre de toutes les pages connectées d'EVP (navigation latérale, identité du compte, avertissement PayFit, thème Micro-Stars, installation PWA) et vocabulaire partagé par tous les écrans (rôles, états d'un dossier, états d'écran). Il remplace l'en-tête bleu et les onglets d'administration du socle (`features/auth/components/AppLayout.tsx`) ; les autres plans y renvoient.

Chemin de rendu : composant de mise en page `studio/src/app/shared/layout/` (nouveau) monté à la place de `AppLayout` ; thème dans `studio/src/app/shared/theme/`.

## Parcours
1. Le visiteur ouvre une page protégée sans session : redirection vers `/connexion?redirection=…` (inchangé, `rule-foundation-protected-redirect`).
2. Session vérifiée par `GET /auth/current-user` puis `GET /profile` : tant que ces appels n'ont pas répondu, seul « Chargement… » est rendu (`rule-foundation-no-protected-flash`).
3. Si `GET /profile` répond `403 access.account_inactive` ou `403 access.not_authorized` (compte désactivé, retiré ou plus inscrit, droits relus à chaque requête) : état local effacé, `POST /auth/logout`, retour à `/connexion?motif=acces-retire`.
4. Connecté : navigation latérale (ordinateur) ou horizontale (mobile), contenu à droite/dessous. Le compteur de notifications non lues est rafraîchi à chaque changement de page et toutes les 60 s tant que l'onglet est visible.
5. Une adresse dont le rôle n'a pas la capacité requise affiche l'écran « Accès refusé » dans la mise en page, sans appel aux routes de la page.
6. Une session de 8 h échue : le prochain appel répond `401` ; retour à `/connexion?motif=session-expiree&redirection=…`.
7. Hors ligne : voir « PWA » ci-dessous.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Marque | « EVP » (lien vers `/`) | En-tête de la navigation, titre en Fredoka | — |
| Avertissement permanent | « Les écritures dans PayFit sont désactivées. EVP ne transmet rien à PayFit : la saisie de paie reste une action humaine. » (`role="note"`) | Toujours visible, sous la marque sur ordinateur, sous la barre de navigation sur mobile ; non fermable | `GET /settings` (`payfitWritesEnabled`, jamais `true` en v1) ; texte affiché même si l'appel échoue |
| Identité du compte | « <Nom> » puis pastille de rôle (« Directrice », « RO », « RH », « Administratrice », « Superadmin ») | Visible en permanence ; l'adresse e-mail en infobulle | `GET /profile` |
| Navigation principale | `<nav aria-label="Navigation principale">` | Entrées ci-dessous, l'entrée active porte `aria-current="page"` | `GET /profile` (`capabilities`) |
| Entrée « À faire » | « À faire » | `/` | — |
| Entrée « Les déclarations » | « Les déclarations » | `/declarations` | — |
| Entrée « Nouvelle absence » | « Nouvelle absence » | `/declarations/nouvelle` ; capacité `absences:create` | — |
| Entrée « Notifications » | « Notifications » ; nom accessible avec compteur : « Notifications, 3 non lues » | `/notifications` ; pastille de compteur (masquée à 0, « 99+ » au-delà de 99) | `GET /notifications/unread-count` |
| Entrée « Les crèches » | « Les crèches » | `/creches` | — |
| Groupe « Administration » | « Administration » (titre de groupe, pas un lien) | Affiché si au moins une des entrées suivantes l'est | — |
| Entrée « Accès » | « Accès » | `/acces` ; capacité `access:manage:ro` | — |
| Entrée « Sources » | « Sources » | `/sources` ; capacité `sources:read` | — |
| Entrée « Export paie » | « Export paie » | `/export-paie` ; capacité `export:run` | — |
| Entrée « Journal » | « Journal » | `/journal` ; capacité `journal:read` | — |
| Entrée « Paramètres » | « Paramètres » | `/parametres` ; tous les rôles | — |
| Bouton de déconnexion | « Se déconnecter » | `POST /auth/logout`, état effacé, retour `/connexion` même si l'appel échoue (`rule-foundation-logout`) | `POST /auth/logout` |
| Zone de contenu | `<main id="contenu">` | Lien d'évitement « Aller au contenu » en premier élément focalisable | — |
| Bannière d'installation | « Installer EVP » | Bouton proposé si le navigateur déclenche `beforeinstallprompt` ; se masque une fois installé | — |
| Bannière hors ligne | « Vous êtes hors ligne. Les données RH ne sont pas disponibles hors ligne. » (`role="alert"`) | Affichée dès que `navigator.onLine` est faux ; les écrans n'affichent aucune donnée mise en cache | — |

### Visibilité des entrées par rôle (déduite des capacités)
| Entrée | Directrice | RO | RH | Administratrice | Superadmin |
|---|---|---|---|---|---|
| À faire, Les déclarations, Notifications, Les crèches, Paramètres | oui | oui | oui | oui | oui |
| Nouvelle absence | oui | oui | oui | non | oui |
| Accès | non | non | oui | oui | oui |
| Sources | non | non | oui | non | oui |
| Export paie, Journal | non | non | oui | non | oui |

Le studio ne teste jamais le nom du rôle : il lit les `capabilities` de `GET /profile` (liste dans `acces-auth-api-modification-request.md`). Le masquage est une commodité ; l'API et la base décident.

### Mise en forme (thème)
- Couleurs (`user`) : action `#3E5FD9`, titres `#2A43A8`, fond léger `#EFF3FF`, vigilance `#FFFBE0`, texte `#262C45`. Fond de page `#EFF3FF`, cartes blanches, bande de vigilance `#FFFBE0` pour les blocages et l'avertissement PayFit. Palette MUI : `primary.main #3E5FD9`, `text.primary #262C45`, `background.default #EFF3FF`, titres `#2A43A8`.
- Typographie (`user`) : titres en Fredoka avec repli `"Nunito", "Varela Round", ui-rounded, system-ui, sans-serif` ; texte en Wix Madefor Display puis `system-ui, sans-serif` ; corps 16 px, interligne 1,6. Polices servies par le studio (paquets `@fontsource/fredoka` et `@fontsource/wix-madefor-display`), sans appel à un service tiers à l'exécution (hypothèse).
- Navigation latérale de 264 px sur ordinateur (`user`), fixe à gauche, défilante si elle dépasse la hauteur. En dessous de 767 px (`user`) : barre horizontale défilante en haut, une seule colonne de contenu, cartes à la place des tableaux. Point de rupture MUI personnalisé : `md = 767`.
- Boutons arrondis (rayon ≥ 23 px) de 46 px de haut au moins (`user`) ; entrées de navigation mobile d'au moins 44 px de haut et de large (`user`).
- Focus clavier visible : contour de 3 px `#2A43A8` avec 2 px de décalage sur tout élément interactif ; aucun `outline: none` sans équivalent.
- Réduction des animations (`user`) : sous `@media (prefers-reduced-motion: reduce)`, transitions et animations MUI désactivées (`transitions.create` renvoie `none`), indicateurs de progression sans mouvement parasite.
- `<html lang="fr">`, `<title>` de chaque page « <Écran> · EVP », `theme-color #3E5FD9`.

## États d'écran communs (composants partagés)
Chaque écran prévoit les six états (`user`) avec ces composants et ces textes :

| État | Composant | Texte par défaut | Notes |
|---|---|---|---|
| Attente | `EtatAttente` | « Chargement… » (`role="status"`, indicateur circulaire) | Un écran ne montre jamais un contenu partiel trompeur : squelette ou indicateur |
| Vide | `EtatVide` | Texte propre à chaque écran, avec une consigne utile | Jamais un tableau sans ligne ni explication |
| Erreur | `EtatErreur` | « Une erreur est survenue. Veuillez réessayer. » + bouton « Réessayer » (`rule-foundation-api-failure-handling`) | `400` de formulaire : « Données invalides. Vérifiez les champs. » ; aucun message technique |
| Interdit | `EtatInterdit` | Titre « Accès refusé », « Vous n'avez pas les droits nécessaires pour consulter cette page. », bouton « Retour à l'accueil » | Garde par capacité ; `403` d'une action : « Action non autorisée. » |
| Succès | notification (`notify`) | Phrase propre à l'action, `role="status"` | Disparaît seule après 6 s, fermable |
| Blocage métier | `BandeVigilance` (fond `#FFFBE0`) | Motif, qui doit agir, prochaine action | Utilisée pour tout dossier bloqué |

### Statut d'un dossier (composant `StatutAbsence`)
Un statut n'est jamais montré par sa seule couleur (`user`) : pastille avec icône, libellé complet et, selon le contexte, le motif et la prochaine action.

| Code API | Libellé | Icône / teinte |
|---|---|---|
| `A_COMPLETER` | « À compléter » | avertissement, fond `#FFFBE0` |
| `ANTICIPEE` | « Anticipée » | horloge, fond `#EFF3FF` |
| `A_VALIDER` | « À valider » | sablier, contour `#3E5FD9` |
| `A_SAISIR` | « Validée, à saisir dans PayFit » ; si `saisieDeclaree` : « Saisie déclarée, à vérifier dans PayFit » | crayon, fond `#EFF3FF` |
| `DANS_PAYFIT` | « Présente dans PayFit » | coche, vert sombre sur vert pâle |
| `REJETEE` | « Rejetée » | croix, rouge sombre sur rose pâle |
| `ANNULEE` | « Annulée » | trait barré, gris |

Libellés des types d'absence (codes `CONGES_PAYES`, `ARRET_MALADIE`, `SANS_SOLDE`, `ENFANT_MALADE`, `ACCIDENT_TRAVAIL`, `RECUPERATION`, `SANS_JUSTIFICATIF`, `EVENEMENT_FAMILIAL`, `AUTRE`) : « Congés payés », « Arrêt maladie », « Sans solde », « Enfant malade », « Accident du travail », « Récupération », « Sans justificatif », « Événement familial », « Autre ». Les libellés viennent de `GET /absence-types` ; le studio ne les code pas en dur sauf repli.

Demi-journées : `MATIN` « matin », `APRES_MIDI` « après-midi ». Dates affichées `jj/mm/aaaa`, heures `jj/mm/aaaa à hh:mm` (fuseau Europe/Paris) ; nombres au format français.

### Qui doit agir (toujours accompagné d'un texte)
Valeurs `actor` : `DECLARANT` « La directrice ou la RO de la crèche », `RH` « RH », `LECTURE_PAYFIT` « Prochaine lecture PayFit », `AUCUN` « Personne : dossier terminé ». Les textes viennent de l'API (`nextAction.actorLabel`).

## PWA
- Manifeste `studio/public/manifest.webmanifest` : `name` « EVP, préparation et suivi des absences », `short_name` « EVP », `lang` `fr`, `start_url` `/`, `scope` `/`, `display` `standalone`, `theme_color` `#3E5FD9`, `background_color` `#EFF3FF`, icônes 192×192 et 512×512 (dont une maskable). Installable sur ordinateur et téléphone (`user`).
- Service worker : met en cache **uniquement** la coquille statique (HTML d'entrée, scripts, styles, polices, icônes, page `hors-ligne.html`). Toute requête vers l'API (`VITE_API_URL`) et toute réponse de `/storage` sont en réseau seul (`NetworkOnly`) : aucune donnée RH, aucun justificatif n'est jamais écrit dans le cache ni dans `localStorage`/`IndexedDB` (`user`).
- Hors ligne, une navigation affiche `hors-ligne.html` : « Vous êtes hors ligne. EVP n'affiche aucune donnée RH hors ligne. Reconnectez-vous pour continuer. » avec le bouton « Réessayer ».
- À la déconnexion, le cache d'exécution éventuel est vidé (hypothèse de prudence).
- L'API ajoute `Cache-Control: no-store` à toutes ses réponses métier (voir les demandes à l'API).

## Règles
- `rule-evp-layout-sidebar` (user) : sur écran de 767 px et plus, la navigation latérale mesure 264 px de large ; en dessous, elle devient une barre horizontale et les contenus passent sur une colonne.
- `rule-evp-layout-account-visible` (user) : le nom et le rôle du compte sont visibles en permanence.
- `rule-evp-layout-payfit-warning` (user) : l'avertissement que les écritures PayFit sont désactivées est permanent et non fermable.
- `rule-evp-layout-nav-by-capability` (inferred) : les entrées de navigation sont déduites des `capabilities`, pas du nom du rôle ; la sécurité repose sur l'API et la base (`user` pour le principe « masquer un bouton ne suffit pas »).
- `rule-evp-layout-theme-tokens` (user) : couleurs, polices, 16 px, interligne 1,6, boutons ≥ 46 px, cibles tactiles de navigation ≥ 44 px.
- `rule-evp-layout-focus-motion` (user) : focus clavier visible et respect de `prefers-reduced-motion`.
- `rule-evp-layout-six-states` (user) : états vide, attente, erreur, interdit et succès prévus sur chaque écran.
- `rule-evp-layout-status-not-color-only` (user) : un statut porte toujours un libellé, un motif utile et la prochaine action.
- `rule-evp-layout-four-questions` (user) : chaque fiche répond à où en est le dossier, qui doit agir, pourquoi il est bloqué, quelle est la prochaine action.
- `rule-evp-pwa-installable` (user) : l'application est installable (manifeste, service worker, icônes).
- `rule-evp-pwa-no-offline-data` (user) : aucune donnée RH n'est disponible hors ligne ; l'API et les justificatifs ne sont jamais mis en cache.
- `rule-evp-session-8h` (user) : la session serveur dure 8 heures ; à son échéance l'utilisateur est renvoyé à la connexion avec « Votre session a expiré. Reconnectez-vous. ».
- `rule-evp-rights-rechecked` (user) : les droits sont revérifiés à chaque requête ; un accès retiré ou désactivé met fin à la session à la requête suivante.
- `rule-evp-account-inactive-logout` (inferred) : `403 access.account_inactive` ou `access.not_authorized` ramène à `/connexion?motif=acces-retire`.
- `rule-evp-unread-badge-refresh` (inferred) : le compteur de notifications est relu à chaque changement de page et toutes les 60 s onglet visible.
- `rule-evp-foundation-admin-hidden` (inferred) : les écrans du socle `/utilisateurs`, `/utilisateurs/import`, `/groupes`, `/perimetres` ne sont plus liés dans la navigation d'EVP ; leurs routes et leur garde `RequireAdmin` restent inchangées (le socle est gelé).

## Accès
Tout utilisateur connecté voit la mise en page. Un visiteur est redirigé vers `/connexion`. Les entrées et pages réservées sont masquées ou, par adresse directe, remplacées par « Accès refusé » ; l'API répond `403` de toute façon.

## Hypothèses
- Le nom de l'application affiché est « EVP » (le nom du socle « Evpms » reste le slug technique).
- La navigation « Paramètres » est ouverte à tous les rôles (« compte, accès et configuration visible, en consultation »).
- Les polices sont embarquées (pas de Google Fonts) pour ne pas envoyer d'adresses IP d'utilisateurs à un tiers et pour que la coquille PWA soit autonome.
- Le groupe « Administration » est un simple titre de section dans la navigation.
- Le seuil de rafraîchissement du compteur (60 s) et l'affichage « 99+ » ne sont pas dans la demande.
- Les teintes vertes et rouges des statuts terminés ne sont pas dans la demande ; elles respectent un contraste AA.
- Le point d'entrée `/` devient « À faire » (le socle prévoit que l'accueil soit remplacé, `rule-foundation-home-replaceable`).
