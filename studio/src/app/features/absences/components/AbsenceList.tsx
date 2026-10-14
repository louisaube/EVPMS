import type { ReactNode } from 'react'
import { Box, Button, Card, CardActionArea, Checkbox, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material'
import { Link, useNavigate } from 'react-router-dom'
import type { components } from '@evpms/api-client'
import { StatutAbsence } from '../../../shared/components/StatutAbsence'
import { periodArrow } from '../../../shared/format'

export type AbsenceSummary = components['schemas']['AbsenceSummaryDto']

export interface Selection {
  selected: ReadonlySet<string>
  toggle: (id: string) => void
  toggleAll: (checked: boolean) => void
}

interface Props {
  items: AbsenceSummary[]
  selection?: Selection
}

function StatusCell({ a }: { a: AbsenceSummary }) {
  return (
    <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
      <StatutAbsence status={a.status} saisieDeclaree={a.saisieDeclaree} />
      {a.blockages.length > 0 && (
        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 260 }} title={a.blockages[0].message}>
          {a.blockages[0].message}
        </Typography>
      )}
    </Stack>
  )
}

function EmployeeCell({ a }: { a: AbsenceSummary }) {
  return (
    <>
      <Typography sx={{ fontWeight: 600 }}>{a.employeeName}</Typography>
      <Typography variant="body2" color="text.secondary">
        {a.contractLabel}
      </Typography>
    </>
  )
}

/**
 * Table (≥ 767 px) or cards (below) of dossiers. The order is the API's; no client sort.
 * rule-evp-list-status-labelled, rule-evp-list-employee-key
 */
export function AbsenceList({ items, selection }: Props) {
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const navigate = useNavigate()
  const link = (id: string) => `/declarations/${id}`
  const selectable = items.filter((a) => a.selectable)
  const allChecked = selection !== undefined && selectable.length > 0 && selectable.every((a) => selection.selected.has(a.id))
  const someChecked = selection !== undefined && selectable.some((a) => selection.selected.has(a.id))

  if (!desktop) {
    return (
      <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {items.map((a) => (
          <Card key={a.id} component="li" variant="outlined">
            <Stack direction="row" sx={{ alignItems: 'flex-start' }}>
              {selection && (
                <Tooltip title={a.selectable ? '' : "Ce dossier n'est pas à valider."}>
                  <span>
                    <Checkbox
                      checked={selection.selected.has(a.id)}
                      disabled={!a.selectable}
                      onChange={() => selection.toggle(a.id)}
                      slotProps={{ input: { 'aria-label': `Sélectionner le dossier de ${a.employeeName}` } }}
                    />
                  </span>
                </Tooltip>
              )}
              <CardActionArea
                component={Link}
                to={link(a.id)}
                aria-label={`Ouvrir le dossier de ${a.employeeName}, ${a.typeLabel}, ${periodArrow(a)}`}
                sx={{ p: 2, flexGrow: 1 }}
              >
                <Stack spacing={1}>
                  <Box>
                    <EmployeeCell a={a} />
                  </Box>
                  <Typography variant="body2">
                    {a.crecheName} · {a.typeLabel}
                  </Typography>
                  <Typography variant="body2">{periodArrow(a)}</Typography>
                  <StatusCell a={a} />
                  <Typography variant="body2">
                    <strong>Prochaine action :</strong> {a.nextAction.label}
                  </Typography>
                </Stack>
              </CardActionArea>
            </Stack>
          </Card>
        ))}
      </Stack>
    )
  }

  return (
    <Paper variant="outlined">
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              {selection && (
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={allChecked}
                    indeterminate={someChecked && !allChecked}
                    disabled={selectable.length === 0}
                    onChange={(_, checked) => selection.toggleAll(checked)}
                    slotProps={{ input: { 'aria-label': 'Sélectionner tous les dossiers à valider' } }}
                  />
                </TableCell>
              )}
              {['Salariée', 'Crèche', 'Type', 'Période', 'État', 'Prochaine action', 'Actions'].map((c) => (
                <TableCell key={c} sx={{ fontWeight: 600 }}>
                  {c}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(link(a.id))}>
                {selection && (
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title={a.selectable ? '' : "Ce dossier n'est pas à valider."}>
                      <span>
                        <Checkbox
                          checked={selection.selected.has(a.id)}
                          disabled={!a.selectable}
                          onChange={() => selection.toggle(a.id)}
                          slotProps={{ input: { 'aria-label': `Sélectionner le dossier de ${a.employeeName}` } }}
                        />
                      </span>
                    </Tooltip>
                  </TableCell>
                )}
                <TableCell>
                  <EmployeeCell a={a} />
                </TableCell>
                <TableCell>{a.crecheName}</TableCell>
                <TableCell>{a.typeLabel}</TableCell>
                <TableCell>{periodArrow(a)}</TableCell>
                <TableCell>
                  <StatusCell a={a} />
                </TableCell>
                <TableCell>{a.nextAction.label}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Button component={Link} to={link(a.id)} variant="outlined" size="small" aria-label={`Ouvrir le dossier de ${a.employeeName}`}>
                    Ouvrir
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}

export function ListCount({ count, children }: { count: number; children?: ReactNode }) {
  return (
    <Typography aria-live="polite" color="text.secondary">
      {count} dossier(s)
      {children}
    </Typography>
  )
}
