import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppProvider } from '@solana/connector/react'
import { getDefaultConfig } from '@solana/connector/headless'
import './index.css'
import App from './App.tsx'
import { getRpcUrl } from './solana/rpcConfig'

const RPC_URL = getRpcUrl()

const connectorConfig = getDefaultConfig({
  appName: 'Omnipair Testing UI',
  autoConnect: true,
  clusters: [
    { id: 'solana:mainnet' as const, label: 'Mainnet', url: RPC_URL },
    { id: 'solana:devnet' as const, label: 'Devnet', url: 'https://api.devnet.solana.com' },
  ],
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider connectorConfig={connectorConfig}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppProvider>
  </StrictMode>,
)
