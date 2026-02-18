import LiquidityHeatmap from '../debug/LiquidityHeatmap'
import type { ProgramAccountResult, SignatureResult } from '../../features/market/types'

type DebugTabProps = {
  rpcUrl: string
  debugLoading: boolean
  debugError: string | null
  poolAccounts: ProgramAccountResult[]
  recentSignatures: SignatureResult[]
  loadDebugData: () => void
}

function DebugTab({
  rpcUrl,
  debugLoading,
  debugError,
  poolAccounts,
  recentSignatures,
  loadDebugData,
}: DebugTabProps) {
  return (
    <div className="debug-panel">
      <div className="debug-top">
        <div>
          <div className="debug-title">Program Debug</div>
          <p>RPC: {rpcUrl}</p>
        </div>
        <button className="ghost-button" onClick={loadDebugData} disabled={debugLoading}>
          {debugLoading ? 'Loading…' : 'Refresh Debug Data'}
        </button>
      </div>

      {debugError && <div className="status-block error">{debugError}</div>}

      <div className="debug-grid">
        <section className="debug-card">
          <h3>Pool Accounts ({poolAccounts.length})</h3>
          <div className="debug-list">
            {poolAccounts.slice(0, 12).map((pool) => (
              <code key={pool.pubkey}>{pool.pubkey}</code>
            ))}
            {!poolAccounts.length && <span>No pools found yet.</span>}
          </div>
        </section>

        <section className="debug-card">
          <h3>Recent Transactions</h3>
          <div className="debug-list">
            {recentSignatures.map((tx) => (
              <div key={tx.signature} className="debug-tx">
                <code>{tx.signature}</code>
                <span>Slot {tx.slot}</span>
                <span>{tx.err ? 'Error' : 'Success'}</span>
              </div>
            ))}
            {!recentSignatures.length && <span>No transactions loaded yet.</span>}
          </div>
        </section>
      </div>

      <LiquidityHeatmap />
    </div>
  )
}

export default DebugTab
