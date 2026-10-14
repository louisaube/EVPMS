import type { ReactNode } from 'react'
import { Alert, Box, Card, CardContent, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, useMediaQuery, useTheme } from '@mui/material'
import { api } from '../../../shared/api'
import { EtatAttente, EtatErreur } from '../../../shared/components/EtatsEcran'
import { PageHeader } from '../../../shared/components/PageHeader'
import { formatDateTime, formatNumber } from '../../../shared/format'
import { evpRoleLabel } from '../../../shared/labels'
import { useCall } from '../../../shared/useCall'
import { useLoad } from '../../../shared/useLoad'
import { useTitle } from '../../../shared/useTitle'
import { useProfile, type Capability } from '../../auth/hooks/useProfile'

/** rule-evp-settings-capability-sentences: informative table, the security is on the API side. */
const CAPABILITY_SENTENCES: Record<Capability, { can: string; cannot: string } | null> = {
  'absences:create': { can: 'Déclarer une absence', cannot: 'Déclarer une absence' },
  'absences:decide': { can: 'Valider, refuser ou demander un complément', cannot: 'Valider une absence' },
  'access:manage:ro': { can: 'Gérer les accès des RO', cannot: 'Gérer les accès des RO' },
  'access:manage:directrice': { can: 'Gérer les accès des directrices', cannot: 'Gérer les accès des directrices' },
  'closures:attest': { can: 'Attester la clôture mensuelle', cannot: 'Attester la clôture mensuelle' },
  'export:run': { can: "Télécharger l'export paie", cannot: "Télécharger l'export" },
  'journal:read': { can: 'Consulter le journal', cannot: 'Consulter le journal' },
  'sources:read': { can: "Consulter l'état des sources", cannot: "Consulter l'état des sources" },
  'sources:refresh:payfit': { can: 'Actualiser la lecture PayFit', cannot: 'Actualiser la lecture PayFit' },
  'sources:refresh:aqoona': { can: 'Actualiser la lecture Aqoona', cannot: 'Actualiser la lecture Aqoona' },
  'sources:refresh:sheets': { can: 'Actualiser la lecture des Contacts des crèches', cannot: 'Actualiser la lecture des Contacts des crèches' },
  'notifications:read': null,
  'profile:read': null,
  'settings:read': null,
}

const ALL_CAPABILITIES = Object.keys(CAPABILITY_SENTENCES) as Capability[]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card component="section">
      <CardContent>
        <Typography variant="h5" component="h2" sx={{ mb: 1.5 }}>
          {title}
        </Typography>
        {children}
      </CardContent>
    </Card>
  )
}

/**
 * rule-evp-settings-readonly, rule-evp-settings-no-editor, rule-evp-settings-no-secret, rule-evp-settings-payfit-disabled,
 * rule-evp-settings-limits-visible, rule-evp-settings-types-defaults, rule-evp-settings-all-roles, rule-evp-settings-capability-sentences
 */
export function ParametresPage() {
  useTitle('Paramètres')
  const call = useCall()
  const { profile } = useProfile()
  const settings = useLoad(() => call(() => api.GET('/settings')), [call])
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))

  const held = new Set<string>(profile.capabilities)
  const can = ALL_CAPABILITIES.filter((c) => CAPABILITY_SENTENCES[c] && held.has(c)).map((c) => CAPABILITY_SENTENCES[c]!.can)
  const cannot = ALL_CAPABILITIES.filter((c) => CAPABILITY_SENTENCES[c] && !held.has(c)).map((c) => CAPABILITY_SENTENCES[c]!.cannot)

  return (
    <>
      <PageHeader title="Paramètres" />
      <Alert severity="info" icon={false} sx={{ mb: 3 }}>
        Cet écran est en consultation. Les accès se modifient dans « Accès » (RH, administratrice, superadmin) ; les types d'absence et les secrets ne s'éditent pas dans EVP.
      </Alert>
      <Stack spacing={3}>
        <Section title="Mon compte">
          <Stack spacing={0.5}>
            <Typography>{profile.name}</Typography>
            <Typography sx={{ overflowWrap: 'anywhere' }}>{profile.email}</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Chip label={evpRoleLabel(profile.role)} color="primary" size="small" />
              <Chip label="Actif" size="small" variant="outlined" />
            </Stack>
            {profile.sessionExpiresAt && <Typography>Votre session expire le {formatDateTime(profile.sessionExpiresAt)} (durée : 8 heures).</Typography>}
          </Stack>
        </Section>

        <Section title="Mes accès">
          <Stack spacing={2}>
            <Box>
              <Typography variant="h6" component="h3">
                Crèches accessibles
              </Typography>
              {profile.scope === 'ALL' ? (
                <Typography>Toutes les crèches</Typography>
              ) : profile.creches.length === 0 ? (
                <Typography>Aucune crèche</Typography>
              ) : (
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {profile.creches.map((c) => (
                    <li key={c.code}>
                      {c.name} ({c.code})
                    </li>
                  ))}
                </Box>
              )}
            </Box>
            <Box>
              <Typography variant="h6" component="h3">
                Ce que vous pouvez faire
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {can.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </Box>
            </Box>
            <Box>
              <Typography variant="h6" component="h3">
                Ce que vous ne pouvez pas faire
              </Typography>
              {cannot.length === 0 ? (
                <Typography>Rien de restreint parmi les droits listés.</Typography>
              ) : (
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {cannot.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </Box>
              )}
            </Box>
          </Stack>
        </Section>

        <Section title="Configuration">
          {settings.state.status === 'loading' && <EtatAttente />}
          {settings.state.status === 'error' && <EtatErreur failure={settings.state.failure} onRetry={settings.reload} />}
          {settings.state.status === 'ready' && (
            <Stack spacing={3}>
              <Box>
                <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
                  Types d'absence
                </Typography>
                {desktop ? (
                  <Paper variant="outlined">
                    <TableContainer>
                      <Table>
                        <TableHead>
                          <TableRow>
                            {['Type', 'Justificatif prévu', 'Examen RH', 'Code PayFit'].map((c) => (
                              <TableCell key={c} sx={{ fontWeight: 600 }}>
                                {c}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {settings.state.data.absenceTypes.map((t) => (
                            <TableRow key={t.code}>
                              <TableCell>{t.label}</TableCell>
                              <TableCell>{t.expectedPiece ? `${t.expectedPiece}${t.privatePiece ? ' (pièce privée)' : ''}` : 'Aucun justificatif requis'}</TableCell>
                              <TableCell>{t.hrReview ? 'Oui' : 'Non'}</TableCell>
                              <TableCell>{t.payfitCode ?? 'Non configuré'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Paper>
                ) : (
                  <Stack spacing={1} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                    {settings.state.data.absenceTypes.map((t) => (
                      <Paper component="li" key={t.code} variant="outlined" sx={{ p: 1.5 }}>
                        <Typography sx={{ fontWeight: 600 }}>{t.label}</Typography>
                        <Typography variant="body2">Justificatif prévu : {t.expectedPiece ? `${t.expectedPiece}${t.privatePiece ? ' (pièce privée)' : ''}` : 'Aucun justificatif requis'}</Typography>
                        <Typography variant="body2">Examen RH : {t.hrReview ? 'Oui' : 'Non'}</Typography>
                        <Typography variant="body2">Code PayFit : {t.payfitCode ?? 'Non configuré'}</Typography>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Box>

              <Box>
                <Typography variant="h6" component="h3">
                  Durées et limites
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  <li>Session : {settings.state.data.limits.sessionHours} heures</li>
                  <li>Lien d'envoi d'un justificatif : {settings.state.data.limits.uploadLinkMinutes} minutes</li>
                  <li>Lien de lecture d'un justificatif : {settings.state.data.limits.readLinkSeconds} secondes</li>
                  <li>
                    Taille maximale d'un justificatif : 10 Mio ({formatNumber(settings.state.data.limits.maxFileBytes)} octets)
                  </li>
                  <li>Formats acceptés : {settings.state.data.limits.formats.join(', ')}</li>
                </Box>
              </Box>

              <Box>
                <Typography variant="h6" component="h3">
                  Fenêtres de lecture
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  <li>PayFit : {settings.state.data.windows.payfit}</li>
                  <li>Aqoona : {settings.state.data.windows.aqoona}</li>
                </Box>
              </Box>

              <Box>
                <Typography variant="h6" component="h3">
                  Écritures PayFit
                </Typography>
                <Typography>Les écritures dans PayFit sont désactivées. (État : Désactivées)</Typography>
              </Box>
            </Stack>
          )}
        </Section>
      </Stack>
    </>
  )
}
