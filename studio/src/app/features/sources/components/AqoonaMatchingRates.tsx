import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import type { components } from '@evpms/api-client'
import { api } from '../../../shared/api'
import { EtatAttente, EtatErreur } from '../../../shared/components/EtatsEcran'
import { formatDate, formatDateTime, formatNumber } from '../../../shared/format'
import { useCall } from '../../../shared/useCall'
import { useLoad } from '../../../shared/useLoad'
import { redactNir } from './redactNir'

type Part = components['schemas']['SourceAqoonaMatchingRatesDto']['items'][number]['linked']

const PERCENT = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** rule-evp-matching-rates-percent: the percentage and the count come from the API; only formatted here. */
function partText(p: Part): string {
  return `${PERCENT.format(p.percent)} % (${formatNumber(p.count)})`
}

export const VISUALLY_HIDDEN = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' } as const

/** Window and last successful Aqoona read, both supplied by the API. */
export function ReadFooter({ d }: { d: { windowFrom: string | null; windowTo: string | null; lastReadAt: string | null } }) {
  if (!d.windowFrom || !d.windowTo || !d.lastReadAt) return null
  return (
    <Typography variant="body2" sx={{ mt: 1 }}>
      Plannings lus du {formatDate(d.windowFrom)} au {formatDate(d.windowTo)}, d'après la lecture d'Aqoona du {formatDateTime(d.lastReadAt)}.
    </Typography>
  )
}

/**
 * rule-evp-matching-rates-people, rule-evp-matching-rates-company-of-person, rule-evp-matching-rates-no-company,
 * rule-evp-matching-rates-unknown-mode, rule-evp-matching-rates-same-rights, rule-evp-nir-key-never-shown
 */
export function AqoonaMatchingRates({ reloadToken }: { reloadToken: number }) {
  const call = useCall()
  const rates = useLoad(() => call(() => api.GET('/sources/aqoona/matching-rates')), [call, reloadToken], true)

  let body
  if (rates.state.status === 'loading') body = <EtatAttente />
  else if (rates.state.status === 'error') body = <EtatErreur failure={rates.state.failure} onRetry={rates.reload} />
  else {
    const d = rates.state.data
    const status = (text: string) => <Typography role="status">{text}</Typography>
    if (d.lastReadAt === null) body = status("Aqoona n'a pas encore été lue : le rattachement des personnes apparaîtra après la première lecture.")
    else if (!d.available) body = status("Le rattachement des personnes sera disponible après la prochaine lecture complète d'Aqoona.")
    else if (d.items.length === 0) body = status('Aucune personne dans les plannings Aqoona de la fenêtre lue.')
    else
      body = (
        <>
          <TableContainer>
            <Table size="small">
              <caption style={VISUALLY_HIDDEN}>Taux de rattachement des personnes Aqoona par société</caption>
              <TableHead>
                <TableRow>
                  <TableCell scope="col">Société</TableCell>
                  <TableCell scope="col" align="right">
                    Personnes
                  </TableCell>
                  <TableCell scope="col" align="right">
                    Rattachées par leur NIR
                  </TableCell>
                  <TableCell scope="col" align="right">
                    Non reliées
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {d.items.map((it) => (
                  <TableRow key={it.companyId ?? 'sans-societe'}>
                    <TableCell component="th" scope="row" sx={{ overflowWrap: 'anywhere' }}>
                      <Box>{redactNir(it.name)}</Box>
                      {it.siret && (
                        <Typography variant="body2" color="text.secondary">
                          SIRET {it.siret}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{formatNumber(it.total)}</TableCell>
                    <TableCell align="right">{partText(it.linked)}</TableCell>
                    <TableCell align="right">{partText(it.unlinked)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <ReadFooter d={d} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Une personne est rattachée quand son NIR dans Aqoona est celui d'une collaboratrice PayFit du réseau, quelle que soit sa société ; elle compte pour sa société PayFit de référence. Sans NIR exploitable, elle n'est pas reliée : le prénom et le nom ne servent jamais au rattachement.
          </Typography>
        </>
      )
  }

  return (
    <Box component="section" aria-labelledby="rattachement-aqoona" sx={{ mt: 4 }}>
      <Typography id="rattachement-aqoona" variant="h5" component="h2" sx={{ mb: 2 }}>
        Rattachement des personnes Aqoona
      </Typography>
      {body}
    </Box>
  )
}
