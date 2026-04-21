import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import AdminGate from './components/AdminGate'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Memos from './pages/Memos'
import Schedules from './pages/Schedules'
import Utilities from './pages/Utilities'
import Community from './pages/Community'
import Admin from './pages/Admin'
import AdminUtilities from './pages/AdminUtilities'
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
        <Route path="community" element={<Community />} />
        <Route path="admin" element={<AdminGate><Admin /></AdminGate>} />
        <Route path="admin/utilities" element={<AdminGate><AdminUtilities /></AdminGate>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
