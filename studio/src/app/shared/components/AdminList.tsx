import type { ReactNode } from 'react'
import { Alert, Box, Button, Card, CircularProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Typography, useMediaQuery, useTheme } from '@mui/material'
import { failureMessage } from '../useCall'
import type { usePagedList } from '../usePagedList'

export interface Column {
  label: string
}

interface Props<T> {
  list: ReturnType<typeof usePagedList<T>>
  columns: Column[]
  emptyText: ReactNode
  /** One table row per item. */
  renderRow: (item: T) => ReactNode
  /** One card per item below 767 px; the table is used when absent. */
  renderCard?: (item: T) => ReactNode
  /** Page sizes offered (10 / 25 / 50 by default). */
  pageSizes?: number[]
}

/** Table card with the common list states: loading, error with « Réessayer », empty, pagination. */
export function AdminList<T>({ list, columns, emptyText, renderRow, renderCard, pageSizes = [10, 25, 50] }: Props<T>) {
  const { state } = list
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const asCards = renderCard !== undefined && !desktop
  return (
    <Card>
      {state.status === 'loading' && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress aria-label="Chargement…" />
        </Box>
      )}
      {state.status === 'error' && (
        <Stack spacing={2} sx={{ p: 2, alignItems: 'flex-start' }}>
          <Alert severity="error" sx={{ alignSelf: 'stretch' }}>
            {failureMessage(state.failure, false)}
          </Alert>
          <Button variant="outlined" onClick={list.reload}>
            Réessayer
          </Button>
        </Stack>
      )}
      {state.status === 'ready' && state.total === 0 && (
        <Typography color="text.secondary" component="div" sx={{ p: 3 }}>
          {emptyText}
        </Typography>
      )}
      {state.status === 'ready' && state.total > 0 && (
        <>
          {asCards ? (
            <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', p: 1.5, m: 0 }}>
              {state.items.map((item, i) => (
                <Card key={i} component="li" variant="outlined" sx={{ p: 1.5 }}>
                  {renderCard(item)}
                </Card>
              ))}
            </Stack>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    {columns.map((c) => (
                      <TableCell key={c.label} sx={{ fontWeight: 600 }}>
                        {c.label}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>{state.items.map(renderRow)}</TableBody>
              </Table>
            </TableContainer>
          )}
          <TablePagination
            component="div"
            count={state.total}
            page={list.page}
            rowsPerPage={list.size}
            rowsPerPageOptions={pageSizes}
            labelRowsPerPage="Lignes par page :"
            onPageChange={(_, p) => list.setPage(p)}
            onRowsPerPageChange={(e) => list.setSize(Number(e.target.value))}
          />
        </>
      )}
    </Card>
  )
}
