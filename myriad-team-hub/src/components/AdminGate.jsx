import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function AdminGate({ children }) {
  const { loading, isAdmin } = useAuth()
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        권한 확인 중...
      </div>
    )
  }
  if (!isAdmin) {
    return <Navigate to="/" replace />
  }
  return children
}
