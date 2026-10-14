import { useState } from 'react'
import { Alert, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'
import { API_URL } from '../../../shared/api'
import { PageHeader } from '../../../shared/components/PageHeader'
import { MESSAGE_END_BEFORE_START, todayParis, toIsoDate } from '../../../shared/format'
import { MESSAGE_FORBIDDEN, MESSAGE_INVALID } from '../../../shared/useCall'
import { useTitle } from '../../../shared/useTitle'
import { useSession } from '../../auth/hooks/useSession'

const MAX_DAYS = 366
const MESSAGE_TOO_LONG = 'La période ne peut pas dépasser 366 jours.'
const MESSAGE_FAILED = "L'export a échoué. Veuillez réessayer."

function daysBetween(from: string, to: string): number {
  return Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000) + 1
}

/** First and last day of a month (month 1–12), as `AAAA-MM-JJ`. */
function monthBounds(year: number, month: number): [string, string] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return [toIsoDate(year, month, 1), toIsoDate(year, month, last)]
}

/** Name proposed by the API's `Content-Disposition`, with the same fallback as the file name rule. */
function fileNameOf(header: string | null, from: string, to: string): string {
  const match = header ? /filename="?([^";]+)"?/i.exec(header) : null
  return match?.[1] ?? `absences-${from}_${to}.csv`
}

/**
 * rule-evp-export-roles, rule-evp-export-period, rule-evp-export-columns, rule-evp-export-audited,
 * rule-evp-export-no-payfit-write, rule-evp-export-post-for-audit, rule-evp-export-max-span, rule-evp-export-csv-format,
 * rule-evp-export-all-statuses, rule-evp-export-no-file-kept
 */
export function ExportPaiePage() {
  useTitle('Export paie')
  const { expire } = useSession()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [empty, setEmpty] = useState(false)

  const inverted = from !== '' && to !== '' && to < from
  const tooLong = from !== '' && to !== '' && !inverted && daysBetween(from, to) > MAX_DAYS
  const missing = from === '' || to === ''

  const shortcut = (offset: 0 | -1) => {
    const [y, m] = todayParis().split('-').map(Number)
    const index = y * 12 + (m - 1) + offset
    const [a, b] = monthBounds(Math.floor(index / 12), (index % 12) + 1)
    setFrom(a)
    setTo(b)
    setDone(false)
    setError(null)
  }

  const download = async () => {
    if (sending || missing || inverted || tooLong) return
    setSending(true)
    setError(null)
    setDone(false)
    setEmpty(false)
    try {
      const response = await fetch(`${API_URL}/exports/absences`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      })
      if (response.status === 401) {
        setTimeout(expire, 300)
        return setError(MESSAGE_FAILED)
      }
      if (!response.ok) return setError(response.status === 400 ? MESSAGE_INVALID : response.status === 403 ? MESSAGE_FORBIDDEN : MESSAGE_FAILED)
      const blob = await response.blob()
      const text = await blob.text()
      // One line (the header) means no absence overlaps the period.
      setEmpty(text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '').length <= 1)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileNameOf(response.headers.get('Content-Disposition'), from, to)
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDone(true)
    } catch {
      setError(MESSAGE_FAILED)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <PageHeader title="Export paie" />
      <Card>
        <CardContent>
          <Stack spacing={3} sx={{ maxWidth: 640 }}>
            <Typography>
              Le fichier contient toute absence qui chevauche la période choisie : crèche, salariée, contrat, type, code PayFit, dates, demi-journées, statut et motif administratif. L'export ne transmet rien à PayFit et il est enregistré au journal.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Date de début de la période" type="date" required value={from} onChange={(e) => { setFrom(e.target.value); setDone(false); setError(null) }} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField
                label="Date de fin de la période"
                type="date"
                required
                value={to}
                onChange={(e) => {
                  setTo(e.target.value)
                  setDone(false)
                  setError(null)
                }}
                slotProps={{ inputLabel: { shrink: true } }}
                error={inverted || tooLong}
                helperText={inverted ? MESSAGE_END_BEFORE_START : tooLong ? MESSAGE_TOO_LONG : undefined}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button variant="outlined" onClick={() => shortcut(-1)}>
                Mois précédent
              </Button>
              <Button variant="outlined" onClick={() => shortcut(0)}>
                Mois en cours
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Fichier CSV encodé en UTF-8, séparateur point-virgule, ouvrable dans Excel.
            </Typography>
            {error && <Alert severity="error" role="alert">{error}</Alert>}
            {done && (
              <Alert severity="success" role="status">
                Export téléchargé. Il est enregistré au journal.
                {empty ? ' Aucune absence ne chevauche cette période : le fichier ne contient que les en-têtes.' : ''}
              </Alert>
            )}
            <Button variant="contained" sx={{ alignSelf: 'flex-start' }} disabled={sending || missing || inverted || tooLong} onClick={() => void download()}>
              {sending ? 'Génération du fichier…' : 'Télécharger le CSV'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </>
  )
}
