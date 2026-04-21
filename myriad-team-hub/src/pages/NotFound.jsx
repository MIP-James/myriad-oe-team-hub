import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <p className="text-6xl font-bold text-slate-300">404</p>
        <p className="mt-2 text-slate-500">페이지를 찾을 수 없습니다.</p>
        <Link to="/" className="inline-block mt-4 text-myriad-ink font-semibold underline">
          대시보드로 돌아가기
        </Link>
      </div>
    </div>
  )
}
