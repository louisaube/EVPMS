import { CssBaseline, ThemeProvider } from '@mui/material'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireSession } from './features/auth/components/RequireSession'
import { SessionProvider } from './features/auth/hooks/useSession'
import { ProfileProvider } from './features/auth/hooks/useProfile'
import { RequireAdmin } from './features/auth/components/RequireAdmin'
import { RequireCapability } from './features/auth/components/RequireCapability'
import { LoginPage } from './features/auth/pages/LoginPage'
import { AccesPage } from './features/access/pages/AccesPage'
import { CrechesPage } from './features/creches/pages/CrechesPage'
import { DeclarationsPage } from './features/absences/pages/DeclarationsPage'
import { DetailAbsencePage } from './features/absences/pages/DetailAbsencePage'
import { NouvelleAbsencePage } from './features/absences/pages/NouvelleAbsencePage'
import { ExportPaiePage } from './features/exports/pages/ExportPaiePage'
import { GroupsPage } from './features/groups/pages/GroupsPage'
import { JournalPage } from './features/journal/pages/JournalPage'
import { NotificationsPage } from './features/notifications/pages/NotificationsPage'
import { ParametresPage } from './features/settings/pages/ParametresPage'
import { ScopesPage } from './features/scopes/pages/ScopesPage'
import { SourcesPage } from './features/sources/pages/SourcesPage'
import { TodoPage } from './features/todo/pages/TodoPage'
import { UsersImportPage } from './features/users/pages/UsersImportPage'
import { UsersPage } from './features/users/pages/UsersPage'
import { EvpLayout } from './shared/layout/EvpLayout'
import { NotifyProvider } from './shared/notify'
import { theme } from './shared/theme/theme'

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <SessionProvider>
          <NotifyProvider>
            <Routes>
              <Route path="/connexion" element={<LoginPage />} />
              <Route element={<RequireSession />}>
                <Route element={<ProfileProvider><EvpLayout /></ProfileProvider>}>
                  <Route path="/" element={<TodoPage />} />
                  <Route path="/declarations" element={<DeclarationsPage />} />
                  <Route element={<RequireCapability capability="absences:create" />}>
                    <Route path="/declarations/nouvelle" element={<NouvelleAbsencePage />} />
                  </Route>
                  <Route path="/declarations/:id" element={<DetailAbsencePage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/creches" element={<CrechesPage />} />
                  <Route path="/parametres" element={<ParametresPage />} />
                  <Route element={<RequireCapability capability="access:manage:ro" />}>
                    <Route path="/acces" element={<AccesPage />} />
                  </Route>
                  <Route element={<RequireCapability capability="sources:read" />}>
                    <Route path="/sources" element={<SourcesPage />} />
                  </Route>
                  <Route element={<RequireCapability capability="export:run" />}>
                    <Route path="/export-paie" element={<ExportPaiePage />} />
                  </Route>
                  {/* rule-evp-journal-guard: /journal is guarded by the capability, not by the foundation's RequireAdmin. */}
                  <Route element={<RequireCapability capability="journal:read" />}>
                    <Route path="/journal" element={<JournalPage />} />
                  </Route>
                  {/* Foundation screens: still routed and guarded, no longer linked (rule-evp-foundation-admin-hidden). */}
                  <Route element={<RequireAdmin />}>
                    <Route path="/utilisateurs" element={<UsersPage />} />
                    <Route path="/groupes" element={<GroupsPage />} />
                    <Route path="/perimetres" element={<ScopesPage />} />
                    <Route path="/utilisateurs/import" element={<UsersImportPage />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Route>
            </Routes>
          </NotifyProvider>
        </SessionProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
