# Demande à l'API : justificatifs (dépôt par URL temporaire, confirmation, lecture)

Écrans demandeurs : Nouvelle absence (composant `JustificatifUploader`), Détail d'une absence. Besoin : joindre un PDF, JPEG ou PNG de 10 Mio au plus sans que les octets transitent par l'API ni la base, puis l'ouvrir par un lien court journalisé.

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `POST /justificatifs/authorize-upload` | `justificatifs:authorize` | user, admin (capacité `absences:create`, crèche du périmètre) | corps `{ crecheCode: 1..20, absenceId?: UUID, fileName: 1..255, contentType: "application/pdf" \| "image/jpeg" \| "image/png", sizeBytes: entier 1..10485760 }` | `201 { id: UUID, uploadUrl: URL, method: "PUT", headers: { [nom]: valeur }, expiresAt }` : URL temporaire valable 5 minutes vers un stockage privé, restreinte au type et à la taille annoncés ; `400 api.validation.incoming_failed` (format ou taille hors bornes) ; `403` (rôle ou crèche hors périmètre) ; `404` (dossier hors périmètre) |
| `POST /justificatifs/{id}/confirm` | `justificatifs:confirm` | user, admin (déposant, ou capacité `absences:create` sur la crèche) | `id` UUID, corps vide | `200 { id, name, sizeBytes, confirmed: true }` ; `409 justificatifs.not_uploaded` (rien déposé) ; `409 justificatifs.size_mismatch` (taille réelle ≠ annoncée ou > 10 485 760) ; `409 justificatifs.signature_mismatch` (signature de format incohérente) ; `409 justificatifs.upload_expired` (plus de 5 minutes) ; `403` ; `404` |
| `POST /justificatifs/{id}/read-link` | `justificatifs:read-link` | user, admin (pièce du périmètre ; pièce privée : RH, superadmin, déposant) | `id` UUID, corps vide | `200 { url: URL, expiresAt }` valable 60 secondes ; `403 justificatifs.private_piece` ; `404` ; `409 justificatifs.not_confirmed` |

## Règles
- `rule-evp-attach-formats` (user) : seuls PDF, JPEG et PNG, 10 485 760 octets au plus, sont acceptés (autorisation, puis contrôle réel à la confirmation).
- `rule-evp-attach-temp-upload` (user) : le dépôt se fait par URL temporaire de 5 minutes vers un stockage privé ; la confirmation par le serveur vérifie la taille réelle et la signature de format.
- `rule-evp-attach-copy-out` (user) : après validation, les octets sont copiés hors de la zone de dépôt, puis la pièce est marquée confirmée.
- `rule-evp-attach-no-files-in-db` (user) : seules les métadonnées (nom, taille, type, clé de stockage, déposant, dossier, statut) sont en base.
- `rule-evp-attach-attached-on-confirm` (user) : la pièce est rattachée au dossier une fois confirmée ; avec `absenceId`, les contrôles du dossier sont rejoués (un blocage « pièce manquante » peut tomber) ; sinon elle est rattachée par `POST /absences` (`justificatifIds`).
- `rule-evp-piece-read-link` (user) : la consultation passe par un lien de lecture de 60 secondes ; aucun lien public permanent n'existe.
- `rule-evp-piece-open-audited` (user) : chaque émission d'un lien de lecture écrit une entrée de journal (opération « Ouverture de justificatif », auteur, dossier) sans nom de fichier d'une pièce privée.
- `rule-evp-piece-no-medical-in-logs` (user) : aucun nom de fichier, contenu ni détail médical dans les journaux techniques ni dans les résumés d'audit.
- `rule-evp-piece-scope` (user) : l'autorisation vérifie le rôle, la crèche, le format et la taille annoncés ; la base limite les lignes selon le rôle et les crèches.
- `rule-evp-piece-unattached-cleanup` (inferred) : une pièce confirmée jamais rattachée est supprimée du stockage au bout de 24 heures (tâche interne, pas un ordonnanceur de lectures de sources).
- `rule-evp-declare-max-pieces` (inferred) : 5 pièces au plus par dossier ; au-delà, `400` à la création ou `409 justificatifs.too_many` à la confirmation avec `absenceId`.
- `rule-evp-attach-single-confirm` (inferred) : confirmer deux fois la même pièce est idempotent (`200`).

## Compatibilité
Routes entièrement nouvelles (fonctionnalité `justificatifs`). Le stockage privé et ses identifiants sont une configuration de l'API, jamais exposée. Le studio envoie le fichier directement à `uploadUrl` sans cookie ni en-tête d'authentification EVP ; le stockage doit donc autoriser l'origine du studio (CORS, méthode `PUT`). Pas de rupture de contrat.
