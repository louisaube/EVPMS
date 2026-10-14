import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TableCell, TableRow, TextField, Tooltip, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import EditIcon from '@mui/icons-material/Edit'
import LinkIcon from '@mui/icons-material/Link'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import PersonOffIcon from '@mui/icons-material/PersonOff'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline'
import { api } from '../../../shared/api'
import { AdminList } from '../../../shared/components/AdminList'
import { PageHeader } from '../../../shared/components/PageHeader'
import { useNotify } from '../../../shared/notify'
import { MESSAGE_FORBIDDEN, failureMessage, useCall } from '../../../shared/useCall'
import { usePagedList } from '../../../shared/usePagedList'
import { useTitle } from '../../../shared/useTitle'
import { useProfile } from '../../auth/hooks/useProfile'
import { useCreches } from '../../creches/hooks/useCreches'
import { AccessDialog, type AccessAccount } from '../components/AccessDialog'

type RoleFilter = '' | 'RO' | 'DIRECTRICE'
type ActiveFilter = '' | 'true' | 'false'

function CrecheChips({ account }: { account: AccessAccount }) {
  if (account.creches.length === 0) return <Typography color="text.secondary">Aucune crèche</Typography>
  const shown = account.creches.slice(0, 3)
  const rest = account.creches.slice(3)
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {shown.map((c) => (
        <Chip key={c.code} label={c.name} size="small" />
      ))}
      {rest.length > 0 && (
        <Tooltip title={rest.map((c) => c.name).join(', ')}>
          <Chip label={`+${rest.length}`} size="small" variant="outlined" />
        </Tooltip>
      )}
    </Box>
  )
}

function StatusCell({ active }: { active: boolean }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      {active ? <CheckCircleIcon fontSize="small" color="success" /> : <PersonOffIcon fontSize="small" color="disabled" />}
      <span>{active ? 'Actif' : 'Désactivé'}</span>
    </Stack>
  )
}

// rule-evp-access-google-linked-visible: text + icon, never an identifier.
function GoogleCell({ linked }: { linked: boolean }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      {linked ? <LinkIcon fontSize="small" color="success" /> : <LinkOffIcon fontSize="small" color="disabled" />}
      <span>{linked ? 'Lié' : 'Non lié'}</span>
    </Stack>
  )
}

const NOT_LINKED = "Cet accès n'est lié à aucun compte Google."

/**
 * rule-evp-access-address-edit, rule-evp-access-google-unlink, rule-evp-access-google-rebind, rule-evp-access-unlink-who,
 * rule-evp-access-google-linked-visible, rule-evp-access-unlink-needs-link, rule-evp-access-unlink-audited,
 * rule-evp-access-unlink-session, rule-evp-access-privileged-google-fix,
 * rule-evp-access-admin, rule-evp-access-who-manages, rule-evp-access-remove-ro, rule-evp-access-source-no-resurrect,
 * rule-evp-access-audited, rule-evp-access-list-scope, rule-evp-access-pagination, rule-evp-access-guard
 */
export function AccesPage() {
  useTitle('Accès')
  const call = useCall()
  const notify = useNotify()
  const { can } = useProfile()
  const creches = useCreches()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<RoleFilter>('')
  const [active, setActive] = useState<ActiveFilter>('')
  const [dialog, setDialog] = useState<{ account?: AccessAccount } | null>(null)
  const [removing, setRemoving] = useState<AccessAccount | null>(null)
  const [sending, setSending] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [unlinking, setUnlinking] = useState<AccessAccount | null>(null)
  const [unlinkError, setUnlinkError] = useState<string | null>(null)

  const list = usePagedList<AccessAccount>(async (from, size) => {
    const outcome = await call(() =>
      api.GET('/access-accounts', {
        params: {
          query: {
            ...(search ? { search } : {}),
            ...(role ? { role } : {}),
            ...(active ? { active } : {}),
            from,
            size: size as 10 | 25 | 50,
          },
        },
      }),
    )
    return outcome.ok ? { ok: true, data: outcome.data } : outcome
  })

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim().slice(0, 100)), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    list.reloadFirst()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, role, active])

  const crecheItems = creches.state.status === 'ready' ? creches.state.data.items : []
  const withDirectrice = can('access:manage:directrice')
  const hasFilter = search !== '' || role !== '' || active !== ''

  // rule-evp-access-unlink-who: the button follows the capability, never the role name.
  const canUnlink = (a: AccessAccount) => (a.role === 'RO' ? can('access:manage:ro') : can('access:manage:directrice'))

  const closeUnlink = () => {
    setUnlinking(null)
    setUnlinkError(null)
  }

  const unlink = async () => {
    if (!unlinking || sending) return
    setSending(true)
    setUnlinkError(null)
    const outcome = await call(() => api.POST('/access-accounts/{id}/unlink-google', { params: { path: { id: unlinking.id } } }))
    setSending(false)
    if (!outcome.ok) {
      const code = outcome.failure.code
      if (code === 'access.google_not_linked' || code === 'access.not_found') list.reload()
      setUnlinkError(
        code === 'access.google_not_linked'
          ? NOT_LINKED
          : code === 'access.not_found'
            ? "Cet accès n'existe plus."
            : code === 'access.privileged_account'
              ? 'Ce compte est privilégié : il ne se gère pas depuis cet écran.'
              : code === 'access.role_not_manageable'
                ? 'Votre rôle ne permet pas de gérer ce type d’accès.'
                : outcome.failure.status === 403
                  ? MESSAGE_FORBIDDEN
                  : failureMessage(outcome.failure),
      )
      return
    }
    closeUnlink()
    notify('Compte Google délié.')
    list.reload()
  }

  const remove = async () => {
    if (!removing || sending) return
    setSending(true)
    setRemoveError(null)
    const outcome = await call(() => api.POST('/access-accounts/{id}/remove', { params: { path: { id: removing.id } } }))
    setSending(false)
    if (!outcome.ok) {
      setRemoveError(
        outcome.failure.code === 'access.privileged_account'
          ? 'Ce compte est privilégié : il ne se gère pas depuis cet écran.'
          : outcome.failure.code === 'access.role_not_manageable'
            ? 'Votre rôle ne permet pas de gérer ce type d’accès.'
            : outcome.failure.status === 403
              ? MESSAGE_FORBIDDEN
              : failureMessage(outcome.failure),
      )
      return
    }
    setRemoving(null)
    notify('Accès retiré.')
    list.reload()
  }

  return (
    <>
      <PageHeader title={withDirectrice ? 'Accès des RO et des directrices' : 'Accès des RO'}>
        <Button variant="contained" onClick={() => setDialog({})}>
          Nouvel accès
        </Button>
      </PageHeader>
      <Typography sx={{ mb: 2 }}>Les comptes privilégiés (RH, administratrice, superadmin) ne se gèrent pas depuis cet écran.</Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          label="Rechercher un accès"
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value.slice(0, 100))}
          sx={{ minWidth: 280 }}
        />
        <TextField select label="Rôle" value={role} onChange={(e) => setRole(e.target.value as RoleFilter)} sx={{ minWidth: 160 }}>
          <MenuItem value="">Tous</MenuItem>
          <MenuItem value="RO">RO</MenuItem>
          {withDirectrice && <MenuItem value="DIRECTRICE">Directrice</MenuItem>}
        </TextField>
        <TextField select label="Statut" value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)} sx={{ minWidth: 160 }}>
          <MenuItem value="">Tous</MenuItem>
          <MenuItem value="true">Actifs</MenuItem>
          <MenuItem value="false">Désactivés</MenuItem>
        </TextField>
      </Stack>

      <AdminList
        list={list}
        columns={[{ label: 'Nom' }, { label: 'Adresse e-mail' }, { label: 'Rôle' }, { label: 'Statut' }, { label: 'Compte Google' }, { label: 'Crèches' }, { label: 'Actions' }]}
        emptyText={hasFilter ? 'Aucun accès ne correspond à votre recherche.' : 'Aucun accès à gérer pour le moment.'}
        renderRow={(a) => (
          <TableRow key={a.id}>
            <TableCell>{a.name}</TableCell>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>{a.email}</TableCell>
            <TableCell>{a.role === 'RO' ? 'RO' : 'Directrice'}</TableCell>
            <TableCell>
              <StatusCell active={a.active} />
            </TableCell>
            <TableCell>
              <GoogleCell linked={a.googleLinked} />
            </TableCell>
            <TableCell>
              <CrecheChips account={a} />
            </TableCell>
            <TableCell>
              <IconButton aria-label={`Modifier l'accès de ${a.name}`} onClick={() => setDialog({ account: a })}>
                <EditIcon />
              </IconButton>
              {canUnlink(a) && (
                <Tooltip title={a.googleLinked ? '' : NOT_LINKED}>
                  <span>
                    <IconButton aria-label={`Délier le compte Google de ${a.name}`} disabled={!a.googleLinked} onClick={() => setUnlinking(a)}>
                      <LinkOffIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              {a.role === 'RO' && (
                <IconButton aria-label={`Retirer l'accès de ${a.name}`} disabled={!a.active && a.creches.length === 0} onClick={() => setRemoving(a)}>
                  <RemoveCircleOutlineIcon />
                </IconButton>
              )}
            </TableCell>
          </TableRow>
        )}
        renderCard={(a) => (
          <Stack spacing={1}>
            <Typography sx={{ fontWeight: 600 }}>{a.name}</Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {a.email}
            </Typography>
            <Typography variant="body2">{a.role === 'RO' ? 'RO' : 'Directrice'}</Typography>
            <StatusCell active={a.active} />
            <Typography variant="body2">Compte Google : {a.googleLinked ? 'Lié' : 'Non lié'}</Typography>
            <CrecheChips account={a} />
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button variant="outlined" onClick={() => setDialog({ account: a })} aria-label={`Modifier l'accès de ${a.name}`}>
                Modifier
              </Button>
              {canUnlink(a) && (
                <Button variant="outlined" disabled={!a.googleLinked} title={a.googleLinked ? undefined : NOT_LINKED} onClick={() => setUnlinking(a)} aria-label={`Délier le compte Google de ${a.name}`}>
                  Délier
                </Button>
              )}
              {a.role === 'RO' && (
                <Button variant="outlined" color="error" disabled={!a.active && a.creches.length === 0} onClick={() => setRemoving(a)} aria-label={`Retirer l'accès de ${a.name}`}>
                  Retirer
                </Button>
              )}
            </Stack>
          </Stack>
        )}
      />

      {dialog && (
        <AccessDialog
          account={dialog.account}
          creches={crecheItems}
          onClose={() => setDialog(null)}
          onSaved={() => {
            const created = dialog.account === undefined
            setDialog(null)
            notify(created ? 'Accès créé.' : 'Accès modifié.')
            if (created) list.reloadFirst()
            else list.reload()
          }}
        />
      )}

      <Dialog open={unlinking !== null} onClose={() => !sending && closeUnlink()} aria-labelledby="deliement-title">
        <DialogTitle id="deliement-title">Délier le compte Google de {unlinking?.name} ?</DialogTitle>
        <DialogContent>
          <Typography>
            L'accès ne sera plus relié à son compte Google actuel. À sa prochaine connexion avec l'adresse de l'accès, le compte Google utilisé sera relié à la place. À utiliser quand la personne a recréé son compte Google. Les sessions déjà ouvertes de cette personne sont coupées : elle devra se reconnecter. Cette action est tracée au journal.
          </Typography>
          {unlinkError && <Alert severity="error" role="alert" sx={{ mt: 2 }}>{unlinkError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeUnlink} disabled={sending}>
            Annuler
          </Button>
          <Button variant="contained" onClick={() => void unlink()} disabled={sending}>
            Délier le compte Google
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={removing !== null}
        onClose={() => {
          if (sending) return
          setRemoving(null)
          setRemoveError(null)
        }}
        aria-labelledby="retrait-title"
      >
        <DialogTitle id="retrait-title">Retirer l'accès de {removing?.name} ?</DialogTitle>
        <DialogContent>
          <Typography>Le compte sera désactivé et ses crèches retirées. Son historique est conservé. Cette action est tracée au journal.</Typography>
          {removeError && <Alert severity="error" sx={{ mt: 2 }}>{removeError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setRemoving(null)
              setRemoveError(null)
            }}
            disabled={sending}
          >
            Annuler
          </Button>
          <Button variant="contained" color="error" onClick={() => void remove()} disabled={sending}>
            Retirer l'accès
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
