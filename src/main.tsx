import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from '@solana/connector/react'
import { getDefaultConfig } from '@solana/connector/headless'
import './index.css'
import App from './App.tsx'

const RPC_URL =
  (import.meta as { env?: { VITE_SOLANA_RPC_URL?: string } })?.env?.VITE_SOLANA_RPC_URL ||
  'https://api.devnet.solana.com'

const connectorConfig = getDefaultConfig({
  appName: 'Omnipair Testing UI',
  autoConnect: true,
  clusters: [
    { id: 'solana:devnet' as const, label: 'Devnet', url: RPC_URL },
    { id: 'solana:mainnet' as const, label: 'Mainnet', url: 'https://api.mainnet-beta.solana.com' },
  ],
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider connectorConfig={connectorConfig}>
      <App />
    </AppProvider>
  </StrictMode>,
)
