import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        로딩 중...
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return children
}
