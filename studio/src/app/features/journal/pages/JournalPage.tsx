import { useEffect, useRef } from 'react'
import { Box, Button, Card, Link as MuiLink, MenuItem, Stack, TableCell, TableRow, TextField, Typography } from '@mui/material'
import { Link, useSearchParams } from 'react-router-dom'
import type { components } from '@evpms/api-client'
import { api } from '../../../shared/api'
import { AdminList } from '../../../shared/components/AdminList'
import { EtatErreur } from '../../../shared/components/EtatsEcran'
import { PageHeader } from '../../../shared/components/PageHeader'
import { MESSAGE_END_BEFORE_START, formatDateTimeSeconds } from '../../../shared/format'
import { useCall } from '../../../shared/useCall'
import { useLoad } from '../../../shared/useLoad'
import { usePagedList } from '../../../shared/usePagedList'
import { useTitle } from '../../../shared/useTitle'

type Entry = components['schemas']['JournalEntryDto']

const DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function EntryDetail({ e }: { e: Entry }) {
  return (
    <>
      {/* rule-evp-journal-plain-text: the summary is rendered as escaped text, never as HTML. */}
      <Typography sx={{ overflowWrap: 'anywhere' }}>{e.summary}</Typography>
      {e.absenceId && (
        <MuiLink component={Link} to={`/declarations/${e.absenceId}`}>
          Ouvrir le dossier
        </MuiLink>
      )}
    </>
  )
}

/**
 * rule-evp-journal-readonly, rule-evp-journal-covers, rule-evp-journal-no-medical, rule-evp-journal-plain-text,
 * rule-evp-journal-pagination, rule-evp-journal-order, rule-evp-journal-url-state, rule-evp-journal-guard,
 * rule-evp-journal-supersedes-foundation
 */
export function JournalPage() {
  useTitle('Journal')
  const call = useCall()
  const [params, setParams] = useSearchParams()
  const filters = useLoad(() => call(() => api.GET('/journal-entries/filters')), [call])

  const rawOperation = params.get('operation') ?? ''
  const rawAuteur = params.get('auteur') ?? ''
  const rawDu = params.get('du') ?? ''
  const rawAu = params.get('au') ?? ''
  const operation = rawOperation.length <= 100 ? rawOperation : ''
  const auteur = UUID.test(rawAuteur) ? rawAuteur : ''
  const du = DAY.test(rawDu) ? rawDu : ''
  const au = DAY.test(rawAu) ? rawAu : ''
  const inverted = du !== '' && au !== '' && au < du
  const hasFilters = operation !== '' || auteur !== '' || du !== '' || au !== ''

  const list = usePagedList<Entry>(async (from, size) => {
    if (inverted) return { ok: true, data: { items: [], total: 0 } }
    return call(() =>
      api.GET('/journal-entries', {
        params: { query: { ...(operation ? { operation } : {}), ...(auteur ? { actorId: auteur } : {}), ...(du ? { dateFrom: du } : {}), ...(au ? { dateTo: au } : {}), from, size: size as 10 | 25 | 50 } },
      }),
    )
  }, 25)

  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    list.reloadFirst()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation, auteur, du, au])

  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const ops = filters.state.status === 'ready' ? filters.state.data.operations : []
  const actors = filters.state.status === 'ready' ? filters.state.data.actors : []

  return (
    <>
      <PageHeader title="Journal" />
      <Typography sx={{ mb: 2 }}>Lecture seule : le journal ne peut être ni modifié ni effacé. Il ne contient aucun détail médical.</Typography>

      {filters.state.status === 'error' && <EtatErreur failure={filters.state.failure} onRetry={filters.reload} />}

      <Card sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>
          <TextField select label="Opération" value={ops.some((o) => o.code === operation) ? operation : ''} onChange={(e) => change('operation', e.target.value)}>
            <MenuItem value="">Toutes</MenuItem>
            {ops.map((o) => (
              <MenuItem key={o.code} value={o.code}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Auteur" value={actors.some((a) => a.id === auteur) ? auteur : ''} onChange={(e) => change('auteur', e.target.value)}>
            <MenuItem value="">Tous</MenuItem>
            {actors.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Du" type="date" value={du} onChange={(e) => change('du', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField
            label="Au"
            type="date"
            value={au}
            onChange={(e) => change('au', e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            error={inverted}
            helperText={inverted ? MESSAGE_END_BEFORE_START : undefined}
          />
        </Box>
        <Stack direction="row" sx={{ mt: 2 }}>
          <Button onClick={() => setParams(new URLSearchParams(), { replace: true })} disabled={!hasFilters}>
            Effacer les filtres
          </Button>
        </Stack>
      </Card>

      <AdminList
        list={list}
        pageSizes={[10, 25, 50]}
        columns={[{ label: 'Date et heure' }, { label: 'Auteur' }, { label: 'Opération' }, { label: 'Détail' }]}
        emptyText="Aucune entrée dans le journal pour ces filtres."
        renderRow={(e) => (
          <TableRow key={e.id}>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>
              <time dateTime={e.occurredAt}>{formatDateTimeSeconds(e.occurredAt)}</time>
            </TableCell>
            <TableCell>
              <Typography>{e.actorName}</Typography>
              {e.actorEmail && (
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                  {e.actorEmail}
                </Typography>
              )}
            </TableCell>
            <TableCell>{e.operationLabel}</TableCell>
            <TableCell sx={{ minWidth: 240 }}>
              <EntryDetail e={e} />
            </TableCell>
          </TableRow>
        )}
        renderCard={(e) => (
          <Stack spacing={0.5}>
            <time dateTime={e.occurredAt}>{formatDateTimeSeconds(e.occurredAt)}</time>
            <Typography sx={{ fontWeight: 600 }}>{e.operationLabel}</Typography>
            <Typography variant="body2">
              {e.actorName}
              {e.actorEmail ? ` · ${e.actorEmail}` : ''}
            </Typography>
            <EntryDetail e={e} />
          </Stack>
        )}
      />
    </>
  )
}
