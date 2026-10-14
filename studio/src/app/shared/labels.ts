/** rule-foundation-role-label: unknown roles are shown as they are. */
export function roleLabel(role: string): string {
  if (role === 'admin') return 'Administrateur'
  if (role === 'user') return 'Utilisateur'
  return evpRoleLabel(role)
}

/** rule-evp-layout-account-visible: roles of the EVP profile. */
export function evpRoleLabel(role: string): string {
  switch (role) {
    case 'DIRECTRICE':
      return 'Directrice'
    case 'RO':
      return 'RO'
    case 'RH':
      return 'RH'
    case 'ADMINISTRATRICE':
      return 'Administratrice'
    case 'SUPERADMIN':
      return 'Superadmin'
    default:
      return role
  }
}

/** Fallback labels of the absence types; the labels normally come from `GET /absence-types`. */
export const TYPE_LABELS: Record<string, string> = {
  CONGES_PAYES: 'Congés payés',
  ARRET_MALADIE: 'Arrêt maladie',
  SANS_SOLDE: 'Sans solde',
  ENFANT_MALADE: 'Enfant malade',
  ACCIDENT_TRAVAIL: 'Accident du travail',
  RECUPERATION: 'Récupération',
  SANS_JUSTIFICATIF: 'Sans justificatif',
  EVENEMENT_FAMILIAL: 'Événement familial',
  AUTRE: 'Autre',
}
