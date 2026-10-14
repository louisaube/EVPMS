/**
 * rule-evp-link-causes: why a row of Aqoona is not linked to a collaborator of PayFit, and the French label of the API.
 * One constant, shared by the list of the persons not linked and by the detail of the anomalies. A label never carries a NIR,
 * a fragment, a hint about the digits, an expected key or an identifier of PayFit (rule-evp-unlinked-list-no-nir).
 */
export const UNLINKED_CAUSES = ['NIR_ABSENT', 'NIR_KEY_INVALID', 'NIR_UNKNOWN', 'NIR_AMBIGUOUS', 'PAYFIT_INCOMPLETE'] as const
export type UnlinkedCause = (typeof UNLINKED_CAUSES)[number]

export const UNLINKED_CAUSE_LABELS: Record<UnlinkedCause, string> = {
  NIR_ABSENT: 'NIR absent dans Aqoona',
  NIR_KEY_INVALID: 'Clé du NIR incorrecte dans Aqoona',
  NIR_UNKNOWN: 'NIR inconnu de PayFit',
  NIR_AMBIGUOUS: 'NIR porté par plusieurs collaboratrices PayFit',
  PAYFIT_INCOMPLETE: 'NIR non vérifié : lecture PayFit incomplète',
}

export const isUnlinkedCause = (value: unknown): value is UnlinkedCause => UNLINKED_CAUSES.includes(value as UnlinkedCause)

/** rule-evp-payfit-scope-every-read: the detail of the anomaly of PayFit for a key without the scope. */
export const PAYFIT_SCOPE_MISSING_DETAIL =
  'La portée « collaborators:social-security:read » manque à la clé de cette société : ses salariées ne peuvent pas être rattachées par leur NIR.'

/** rule-evp-aqoona-nir-unavailable: the details of « Rapprochement par NIR indisponible » (the names are never used instead). */
export const AQOONA_SCOPE_MISSING_DETAIL =
  'La portée « collaborators:social-security:read » manque à la clé PayFit. Les collaboratrices de cette société ne peuvent pas être trouvées par leur NIR.'
export const AQOONA_NIR_UNAVAILABLE_DETAIL = 'Les collaboratrices de cette société ne peuvent pas être trouvées par leur NIR.'

/** rule-evp-company-named-in-anomalies: « <Nom> (SIRET <14 chiffres>) », « Société sans nom connu (SIRET …) » when the name is unknown. */
export function companyLabel(name: string | null | undefined, siret: string): string {
  return `${name?.trim() || 'Société sans nom connu'} (SIRET ${siret})`
}
