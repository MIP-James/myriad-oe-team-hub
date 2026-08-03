import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import AdminGate from './components/AdminGate'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Memos from './pages/Memos'
import Schedules from './pages/Schedules'
import Utilities from './pages/Utilities'
import Launcher from './pages/Launcher'
import Jobs from './pages/Jobs'
import SharedSheets from './pages/SharedSheets'
import Reports from './pages/Reports'
import MonitoringReport from './pages/MonitoringReport'
import ReportGroups from './pages/ReportGroups'
import ReportGroupDetail from './pages/ReportGroupDetail'
import Community from './pages/Community'
import CaseDetail from './pages/CaseDetail'
import Targets from './pages/Targets'
import Vero from './pages/Vero'
import Admin from './pages/Admin'
import AdminUtilities from './pages/AdminUtilities'
import AdminExternalShortcuts from './pages/AdminExternalShortcuts'
import AdminUsers from './pages/AdminUsers'
import AdminInboundStatus from './pages/AdminInboundStatus'
import AdminWhitelist from './pages/AdminWhitelist'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="memos" element={<Memos />} />
        <Route path="schedules" element={<Schedules />} />
        <Route path="utilities" element={<Utilities />} />
        <Route path="launcher" element={<Launcher />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="sheets" element={<SharedSheets />} />
        <Route path="reports" element={<Reports />} />
        <Route path="monitoring-report" element={<MonitoringReport />} />
        <Route path="reports/groups" element={<ReportGroups />} />
        <Route path="reports/groups/:id" element={<ReportGroupDetail />} />
        <Route path="targets" element={<Targets />} />
        <Route path="vero" element={<Vero />} />
        <Route path="community" element={<Community />} />
        <Route path="community/cases/new" element={<CaseDetail mode="new" />} />
        <Route path="community/cases/:id" element={<CaseDetail />} />
        <Route path="admin" element={<AdminGate><Admin /></AdminGate>} />
        <Route path="admin/utilities" element={<AdminGate><AdminUtilities /></AdminGate>} />
        <Route path="admin/shortcuts" element={<AdminGate><AdminExternalShortcuts /></AdminGate>} />
        <Route path="admin/users" element={<AdminGate><AdminUsers /></AdminGate>} />
        <Route path="admin/inbound-status" element={<AdminGate><AdminInboundStatus /></AdminGate>} />
        <Route path="admin/whitelist" element={<AdminGate><AdminWhitelist /></AdminGate>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
