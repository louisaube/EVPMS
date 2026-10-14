import type { ReactElement } from 'react'
import { Chip } from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import ScheduleIcon from '@mui/icons-material/Schedule'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import EditIcon from '@mui/icons-material/Edit'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import BlockIcon from '@mui/icons-material/Block'
import { COLORS } from '../theme/theme'

export type StatutCode = 'A_COMPLETER' | 'ANTICIPEE' | 'A_VALIDER' | 'A_SAISIR' | 'DANS_PAYFIT' | 'REJETEE' | 'ANNULEE'

export const STATUT_ORDER: StatutCode[] = ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR', 'DANS_PAYFIT', 'REJETEE', 'ANNULEE']

/** rule-evp-validated-is-to-enter, rule-evp-mark-entered-no-proof */
export function statutLabel(status: string, saisieDeclaree = false): string {
  switch (status) {
    case 'A_COMPLETER':
      return 'À compléter'
    case 'ANTICIPEE':
      return 'Anticipée'
    case 'A_VALIDER':
      return 'À valider'
    case 'A_SAISIR':
      return saisieDeclaree ? 'Saisie déclarée, à vérifier dans PayFit' : 'Validée, à saisir dans PayFit'
    case 'DANS_PAYFIT':
      return 'Présente dans PayFit'
    case 'REJETEE':
      return 'Rejetée'
    case 'ANNULEE':
      return 'Annulée'
    default:
      return status
  }
}

interface Look {
  icon: ReactElement
  bg: string
  fg: string
  border: string
  strike?: boolean
}

function look(status: string): Look {
  switch (status) {
    case 'A_COMPLETER':
      return { icon: <WarningAmberIcon />, bg: COLORS.vigilance, fg: '#5C4A00', border: '#E6D96B' }
    case 'ANTICIPEE':
      return { icon: <ScheduleIcon />, bg: COLORS.light, fg: COLORS.title, border: '#C5D1F5' }
    case 'A_VALIDER':
      return { icon: <HourglassEmptyIcon />, bg: '#fff', fg: COLORS.title, border: COLORS.action }
    case 'A_SAISIR':
      return { icon: <EditIcon />, bg: COLORS.light, fg: COLORS.title, border: '#C5D1F5' }
    case 'DANS_PAYFIT':
      return { icon: <CheckCircleIcon />, bg: '#E3F4E6', fg: '#1B5E20', border: '#A5D6A7' }
    case 'REJETEE':
      return { icon: <CancelIcon />, bg: '#FCE4E8', fg: '#8E1B2E', border: '#F2A7B3' }
    default:
      return { icon: <BlockIcon />, bg: '#ECEEF2', fg: '#4A4F5E', border: '#C9CDD6', strike: true }
  }
}

/** rule-evp-layout-status-not-color-only: icon + full label, never a colour alone. */
export function StatutAbsence({ status, saisieDeclaree = false }: { status: string; saisieDeclaree?: boolean }) {
  const l = look(status)
  return (
    <Chip
      icon={l.icon}
      label={statutLabel(status, saisieDeclaree)}
      sx={{
        bgcolor: l.bg,
        color: l.fg,
        border: `1px solid ${l.border}`,
        fontWeight: 600,
        height: 'auto',
        py: 0.5,
        '& .MuiChip-label': { whiteSpace: 'normal', textDecoration: l.strike ? 'line-through' : undefined },
        '& .MuiChip-icon': { color: l.fg },
      }}
    />
  )
}
