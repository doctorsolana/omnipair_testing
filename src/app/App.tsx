import AppShell from '@/app/shell/AppShell'
import AppRouter from '@/app/router'
import { WalletPanelProvider } from '@/integrations/wallet/WalletPanelContext'

function App() {
  return (
    <WalletPanelProvider>
      <AppShell>
        <AppRouter />
      </AppShell>
    </WalletPanelProvider>
  )
}

export default App
