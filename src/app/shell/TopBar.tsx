import { useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useConnector } from '@solana/connector'
import { ConnectWallet } from '@/integrations/wallet/ConnectWallet'
import { useWalletPanel } from '@/integrations/wallet/WalletPanelContext'

function TopBar() {
  const { account, isConnected } = useConnector()
  const { walletPanelOpen, toggleWalletPanel, closeWalletPanel } = useWalletPanel()

  const walletLabel = useMemo(() => {
    if (!isConnected || !account) return 'Connect Wallet'
    return `${account.slice(0, 4)}…${account.slice(-4)}`
  }, [account, isConnected])

  useEffect(() => {
    if (!walletPanelOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      closeWalletPanel()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeWalletPanel, walletPanelOpen])

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-icon" aria-hidden>
              ☁️
            </span>
            <span className="brand-name">omni_test</span>
          </div>
          <div className="header-actions">
            <div className="wallet-dropdown">
              <button className="wallet-pill" onClick={toggleWalletPanel}>
                {walletLabel}
              </button>
            </div>
          </div>
        </div>
      </header>

      {walletPanelOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="wallet-modal-backdrop" onClick={closeWalletPanel}>
            <div
              className="wallet-modal"
              role="dialog"
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="wallet-modal-head">
                <h3>Wallet</h3>
                <button
                  type="button"
                  className="wallet-modal-close"
                  onClick={closeWalletPanel}
                  aria-label="Close wallet modal"
                >
                  ×
                </button>
              </div>
              <ConnectWallet />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

export default TopBar
