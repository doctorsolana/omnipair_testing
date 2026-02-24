import { useConnector } from '@solana/connector'

export function ConnectWallet() {
  const { connectors, connectWallet, disconnectWallet, isConnected, isConnecting, account } = useConnector()

  if (isConnected && account) {
    return (
      <div className="wallet-stack">
        <div className="wallet-status success">Connected</div>
        <code className="wallet-address">{account}</code>
        <button className="ghost-button" onClick={disconnectWallet}>
          Disconnect
        </button>
      </div>
    )
  }

  if (!connectors.length) {
    return (
      <div className="wallet-stack wallet-center">
        <div className="wallet-status">No wallets detected</div>
        <p className="wallet-hint">Install a Solana wallet extension to continue.</p>
      </div>
    )
  }

  return (
    <div className="wallet-stack">
      <div className="wallet-status">Select wallet</div>
      {connectors.map((connector) => (
        <button
          key={connector.id}
          onClick={() => connectWallet(connector.id)}
          disabled={isConnecting || !connector.ready}
          className="wallet-button"
        >
          {connector.icon && <img src={connector.icon} alt="" className="wallet-icon" />}
          <span className="wallet-name">{connector.name}</span>
          {isConnecting && <span className="wallet-muted">…</span>}
        </button>
      ))}
    </div>
  )
}
