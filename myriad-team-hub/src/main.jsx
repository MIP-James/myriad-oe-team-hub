import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { registerServiceWorker } from './lib/push'

// PWA Service Worker 등록 — push 알림 수신 + 클릭 라우팅용.
// 브라우저 호환성 자체 체크 들어있어서 미지원 환경에선 noop.
// 권한 요청은 사용자가 설정 모달에서 명시적으로 [켜기] 클릭 시.
registerServiceWorker().catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
