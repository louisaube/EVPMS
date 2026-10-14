import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Alert, Box, Button, IconButton, LinearProgress, Stack, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloseIcon from '@mui/icons-material/Close'
import { API_URL, api } from '../api'
import { formatSize } from '../format'
import { useCall, type Failure } from '../useCall'

export interface ConfirmedPiece {
  id: string
  name: string
  sizeBytes: number
}

interface Props {
  title?: string
  /** Crèche of the piece; the API derives it from the dossier or the only crèche when absent. */
  crecheCode?: string
  /** Dossier the piece is attached to on confirmation (detail screen). */
  absenceId?: string
  /** Pieces confirmed and not yet attached, shown with « Retirer <nom> ». */
  pieces?: ConfirmedPiece[]
  maxPieces?: number
  disabled?: boolean
  onConfirmed: (piece: ConfirmedPiece) => void
  onRemove?: (id: string) => void
  onBusyChange?: (busy: boolean) => void
}

const MAX_BYTES = 10_485_760

const EXTENSIONS: Record<string, 'application/pdf' | 'image/jpeg' | 'image/png'> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

const MESSAGE_FORMAT = 'Format non pris en charge. Déposez un PDF, un JPEG ou un PNG.'
const MESSAGE_EMPTY = 'Le fichier est vide.'
const MESSAGE_TOO_BIG = 'Le fichier est trop volumineux (maximum 10 Mio).'
const MESSAGE_REFUSED = "Ce fichier n'a pas pu être validé. Vérifiez qu'il s'agit d'un PDF, d'un JPEG ou d'un PNG de 10 Mio au maximum, puis réessayez."
const MESSAGE_NETWORK = "L'envoi a échoué. Réessayez."

type Step = 'idle' | 'authorize' | 'upload' | 'verify'

/** MIME type allowed by the API for a file name, or null. */
function contentTypeOf(file: File): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const byExt = EXTENSIONS[ext]
  if (!byExt) return null
  if (file.type && !Object.values(EXTENSIONS).includes(file.type as never)) return null
  return byExt
}

/** Local checks only for convenience; the API checks the real size and signature. */
function localError(file: File): string | null {
  if (!contentTypeOf(file)) return MESSAGE_FORMAT
  if (file.size === 0) return MESSAGE_EMPTY
  if (file.size > MAX_BYTES) return MESSAGE_TOO_BIG
  return null
}

function putFile(url: string, headers: Record<string, string>, file: File, onProgress: (ratio: number) => void, abortRef: { current: (() => void) | null }): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    // rule-evp-attach-temp-upload: no cookie is sent to the storage domain.
    xhr.withCredentials = false
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
    xhr.onerror = () => reject(new Error('network'))
    xhr.onabort = () => reject(new Error('abort'))
    abortRef.current = () => xhr.abort()
    xhr.send(file)
  })
}

/**
 * Upload by temporary URL then server-side confirmation.
 * rule-evp-attach-formats, rule-evp-attach-temp-upload, rule-evp-attach-no-files-in-db, rule-evp-declare-max-pieces,
 * rule-evp-piece-no-medical-in-logs (no file name is ever logged).
 */
export function JustificatifUploader({ title = 'Justificatif', crecheCode, absenceId, pieces = [], maxPieces = 5, disabled, onConfirmed, onRemove, onBusyChange }: Props) {
  const call = useCall()
  const input = useRef<HTMLInputElement>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const lastFile = useRef<File | null>(null)
  const [step, setStep] = useState<Step>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [retryable, setRetryable] = useState(false)
  const [dragging, setDragging] = useState(false)

  const busy = step !== 'idle'
  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  const refused = (failure: Failure) => {
    if (failure.status === 0) {
      setRetryable(true)
      return setError(MESSAGE_NETWORK)
    }
    setError(MESSAGE_REFUSED)
  }

  const authorize = async (file: File, contentType: 'application/pdf' | 'image/jpeg' | 'image/png') => {
    return call(() =>
      api.POST('/justificatifs/authorize-upload', {
        body: { ...(crecheCode ? { crecheCode } : {}), ...(absenceId ? { absenceId } : {}), fileName: file.name, contentType, sizeBytes: file.size },
      }),
    )
  }

  const send = async (file: File) => {
    const contentType = contentTypeOf(file)
    if (!contentType) return
    setError(null)
    setRetryable(false)
    setProgress(0)
    setStep('authorize')
    let auth = await authorize(file, contentType)
    if (!auth.ok) {
      setStep('idle')
      return refused(auth.failure)
    }
    // The link is valid 5 minutes: ask again, silently, if it has lapsed before the upload starts.
    if (new Date(auth.data.expiresAt).getTime() <= Date.now()) {
      auth = await authorize(file, contentType)
      if (!auth.ok) {
        setStep('idle')
        return refused(auth.failure)
      }
    }
    const { id, uploadUrl, headers } = auth.data
    setStep('upload')
    try {
      const url = new URL(uploadUrl, API_URL).toString()
      const ok = await putFile(url, headers, file, setProgress, abortRef)
      if (!ok) {
        setStep('idle')
        return setError(MESSAGE_REFUSED)
      }
    } catch (e) {
      setStep('idle')
      if (e instanceof Error && e.message === 'abort') return
      setRetryable(true)
      return setError(MESSAGE_NETWORK)
    } finally {
      abortRef.current = null
    }
    setStep('verify')
    const confirmed = await call(() => api.POST('/justificatifs/{id}/confirm', { params: { path: { id } } }))
    setStep('idle')
    if (!confirmed.ok) return refused(confirmed.failure)
    lastFile.current = null
    onConfirmed({ id: confirmed.data.id, name: confirmed.data.name, sizeBytes: confirmed.data.sizeBytes })
  }

  const choose = (file: File | undefined) => {
    if (!file || busy || disabled) return
    const problem = localError(file)
    if (problem) {
      setRetryable(false)
      return setError(problem)
    }
    lastFile.current = file
    void send(file)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    choose(event.dataTransfer.files[0])
  }

  const full = pieces.length >= maxPieces

  return (
    <Stack spacing={1.5} component="section" aria-label={title}>
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>

      {!full && (
        <Box
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          sx={{ border: '2px dashed', borderColor: dragging ? 'primary.main' : '#9FB1EB', bgcolor: dragging ? '#E3EAFF' : '#fff', borderRadius: 3, p: 2, textAlign: 'center' }}
        >
          <Typography sx={{ mb: 1 }}>Glissez un fichier PDF, JPEG ou PNG ici</Typography>
          <input
            ref={input}
            type="file"
            hidden
            accept=".pdf,.jpg,.jpeg,.png"
            aria-label="Justificatif à joindre"
            onChange={(e) => {
              choose(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Button variant="outlined" onClick={() => input.current?.click()} disabled={busy || disabled}>
            Choisir un fichier
          </Button>
        </Box>
      )}
      <Typography variant="body2" color="text.secondary">
        PDF, JPEG ou PNG, 10 Mio au maximum.
      </Typography>

      {step === 'authorize' && <Typography role="status">Autorisation…</Typography>}
      {step === 'upload' && (
        <Stack spacing={1} role="status">
          <Typography>Envoi du fichier…</Typography>
          <LinearProgress variant="determinate" value={Math.round(progress * 100)} aria-label="Progression de l'envoi" />
          <Button size="small" onClick={() => abortRef.current?.()} sx={{ alignSelf: 'flex-start' }}>
            Annuler l'envoi
          </Button>
        </Stack>
      )}
      {step === 'verify' && <Typography role="status">Vérification du fichier…</Typography>}

      {error && (
        <Alert severity="error" role="alert" action={retryable && lastFile.current ? <Button color="inherit" size="small" onClick={() => lastFile.current && void send(lastFile.current)}>Réessayer</Button> : undefined}>
          {error}
        </Alert>
      )}

      {pieces.length > 0 && (
        <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {pieces.map((p) => (
            <Stack component="li" key={p.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CheckCircleIcon color="success" aria-hidden />
              <Typography sx={{ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                {p.name} — {formatSize(p.sizeBytes)} — Confirmé
              </Typography>
              {onRemove && (
                <IconButton aria-label={`Retirer ${p.name}`} onClick={() => onRemove(p.id)} disabled={busy}>
                  <CloseIcon />
                </IconButton>
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
