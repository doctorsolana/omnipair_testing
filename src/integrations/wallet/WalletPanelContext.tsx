import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type WalletPanelContextValue = {
  walletPanelOpen: boolean
  openWalletPanel: () => void
  closeWalletPanel: () => void
  toggleWalletPanel: () => void
}

const WalletPanelContext = createContext<WalletPanelContextValue | null>(null)

type WalletPanelProviderProps = {
  children: ReactNode
}

export function WalletPanelProvider({ children }: WalletPanelProviderProps) {
  const [walletPanelOpen, setWalletPanelOpen] = useState(false)

  const openWalletPanel = useCallback(() => {
    setWalletPanelOpen(true)
  }, [])

  const closeWalletPanel = useCallback(() => {
    setWalletPanelOpen(false)
  }, [])

  const toggleWalletPanel = useCallback(() => {
    setWalletPanelOpen((value) => !value)
  }, [])

  const value = useMemo(
    () => ({
      walletPanelOpen,
      openWalletPanel,
      closeWalletPanel,
      toggleWalletPanel,
    }),
    [closeWalletPanel, openWalletPanel, toggleWalletPanel, walletPanelOpen],
  )

  return <WalletPanelContext.Provider value={value}>{children}</WalletPanelContext.Provider>
}

export function useWalletPanel() {
  const context = useContext(WalletPanelContext)
  if (!context) {
    throw new Error('useWalletPanel must be used within WalletPanelProvider')
  }
  return context
}
