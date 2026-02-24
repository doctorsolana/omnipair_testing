import type { ReactNode } from 'react'
import TopBar from '@/app/shell/TopBar'

type AppShellProps = {
  children: ReactNode
}

function AppShell({ children }: AppShellProps) {
  return (
    <div className="page">
      <TopBar />
      {children}
    </div>
  )
}

export default AppShell
