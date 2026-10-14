import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Typography } from '@mui/material'
import type { components } from '@evpms/api-client'
import { api } from '../../../shared/api'
import { EtatAttente } from '../../../shared/components/EtatsEcran'
import { failureMessage, useCall } from '../../../shared/useCall'
import { usePagedList } from '../../../shared/usePagedList'
import { ReadFooter, VISUALLY_HIDDEN } from './AqoonaMatchingRates'
import { redactNir } from './redactNir'

type Dto = components['schemas']['SourceAqoonaUnlinkedPeopleDto']
type Person = Dto['items'][number]
type Meta = Pick<Dto, 'available' | 'lastReadAt' | 'windowFrom' | 'windowTo'>

/**
 * rule-evp-unlinked-list, rule-evp-unlinked-list-grain, rule-evp-unlinked-list-paging,
 * rule-evp-unlinked-list-all-causes-visible, rule-evp-unlinked-list-no-nir, rule-evp-unlinked-list-same-rights
 */
export function AqoonaUnlinkedPeople({ reloadToken }: { reloadToken: number }) {
  const call = useCall()
  const [meta, setMeta] = useState<Meta | null>(null)
  const list = usePagedList<Person>(async (from, size) => {
    const outcome = await call(() => api.GET('/sources/aqoona/unlinked-people', { params: { query: { from, size: size as 10 | 25 | 50 } } }))
    if (outcome.ok) {
      const { available, lastReadAt, windowFrom, windowTo } = outcome.data
      setMeta({ available, lastReadAt, windowFrom, windowTo })
    }
    return outcome
  }, 25)

  // Back to page 1 when the section is read again after a read started or followed from the screen.
  const first = useRef(true)
  const { reloadFirst } = list
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    reloadFirst()
  }, [reloadToken, reloadFirst])

  const { state } = list
  let body
  if (state.status === 'loading') body = <EtatAttente />
  else if (state.status === 'error')
    body = (
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Alert severity="error" sx={{ alignSelf: 'stretch' }}>
          {failureMessage(state.failure, false)}
        </Alert>
        <Button variant="outlined" onClick={list.reload}>
          Réessayer
        </Button>
      </Stack>
    )
  else {
    const status = (text: string) => <Typography role="status">{text}</Typography>
    if (meta === null || meta.lastReadAt === null) body = status("Aqoona n'a pas encore été lue : le rattachement des personnes apparaîtra après la première lecture.")
    else if (!meta.available) body = status("Le rattachement des personnes sera disponible après la prochaine lecture complète d'Aqoona.")
    else if (state.total === 0) body = status('Toutes les personnes des plannings Aqoona sont reliées à PayFit.')
    else
      body = (
        <>
          <TableContainer>
            <Table size="small">
              <caption style={VISUALLY_HIDDEN}>Personnes non reliées entre Aqoona et PayFit</caption>
              <TableHead>
                <TableRow>
                  <TableCell scope="col">Personne</TableCell>
                  <TableCell scope="col">Cause</TableCell>
                  <TableCell scope="col">Crèche</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {state.items.map((p, i) => (
                  <TableRow key={`${i}-${p.name}-${p.cause}`}>
                    <TableCell component="th" scope="row" sx={{ overflowWrap: 'anywhere' }}>
                      {redactNir(p.name)}
                    </TableCell>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{redactNir(p.causeLabel)}</TableCell>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{p.creches.length === 0 ? 'Crèche inconnue' : redactNir(p.creches.join(', '))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={state.total}
            page={list.page}
            rowsPerPage={list.size}
            rowsPerPageOptions={[10, 25, 50]}
            labelRowsPerPage="Lignes par page :"
            onPageChange={(_, p) => list.setPage(p)}
            onRowsPerPageChange={(e) => list.setSize(Number(e.target.value))}
          />
          <ReadFooter d={meta} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            La liste nomme les personnes à corriger dans Aqoona ou dans PayFit. Elle n'affiche jamais de NIR.
          </Typography>
        </>
      )
  }

  return (
    <Box component="section" aria-labelledby="personnes-non-reliees" sx={{ mt: 4 }}>
      <Typography id="personnes-non-reliees" variant="h5" component="h2" sx={{ mb: 2 }}>
        Personnes non reliées entre Aqoona et PayFit
      </Typography>
      {body}
    </Box>
  )
}
