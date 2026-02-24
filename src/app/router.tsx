import { Route, Routes } from 'react-router-dom'
import MarketsPage from '@/pages/MarketsPage'
import PoolDetailPage from '@/pages/PoolDetailPage'
import NewPoolPage from '@/pages/NewPoolPage'

function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<MarketsPage />} />
      <Route path="/pools/:address" element={<PoolDetailPage />} />
      <Route path="/pools/new" element={<NewPoolPage />} />
    </Routes>
  )
}

export default AppRouter
