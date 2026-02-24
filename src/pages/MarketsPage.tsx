import { useEffect, useState } from 'react'
import { useConnector } from '@solana/connector'
import TabsNav from '@/app/shell/TabsNav'
import BorrowTab from '@/features/borrow/ui/BorrowTab'
import { useBorrowController } from '@/features/borrow/hooks/useBorrowController'
import DebugTab from '@/features/debug/ui/DebugTab'
import { useDebugController } from '@/features/debug/hooks/useDebugController'
import type { AppTab } from '@/features/market/types'
import PoolsTab from '@/features/pools/ui/PoolsTab'
import { usePoolsController } from '@/features/pools/hooks/usePoolsController'
import PositionsTab from '@/features/positions/ui/PositionsTab'
import { usePositionsController } from '@/features/positions/hooks/usePositionsController'
import TradeTab from '@/features/trade/ui/TradeTab'
import { useTradeController } from '@/features/trade/hooks/useTradeController'
import { useRpc } from '@/integrations/wallet/useRpc'
import { useSendSmartTransaction } from '@/integrations/wallet/useSendSmartTransaction'

function MarketsPage() {
  const { account, isConnected } = useConnector()
  const { rpcUrl } = useRpc()
  const { signer, simulate, send } = useSendSmartTransaction()

  const [activeTab, setActiveTab] = useState<AppTab>('Pools')

  const poolsController = usePoolsController({ rpcUrl })
  const {
    pools,
    poolsLoading,
    poolsError,
    poolAccounts,
    poolSelectOptions,
    hasLoadedPools,
    loadPools,
  } = poolsController

  const positionsController = usePositionsController({
    account: account ?? null,
    isConnected,
    rpcUrl,
    pools,
    signer,
    simulate,
    send,
    onRepaySuccess: () => {
      void loadPools()
    },
    onRemoveCollateralSuccess: () => {
      void loadPools()
    },
  })
  const {
    positionsLoading,
    positionsError,
    loanPositions,
    lpPositions,
    poolSymbolsByAddress,
    loadPositionsData,
    executeRepayLoan,
    executeRemoveCollateral,
  } = positionsController

  const borrowController = useBorrowController({
    pools,
    poolSelectOptions,
    loanPositions,
    account: account ?? null,
    isConnected,
    rpcUrl,
    signer,
    simulate,
    send,
    isActive: activeTab === 'Borrow',
    onBorrowSuccess: () => {
      void loadPools()
      void loadPositionsData()
    },
  })
  const { refreshBorrowTokenBalances } = borrowController

  const handleTradeSuccess = () => {
    void loadPools()
    void loadPositionsData()
    void refreshBorrowTokenBalances()
  }

  const tradeController = useTradeController({
    pools,
    poolSelectOptions,
    loanPositions,
    account: account ?? null,
    isConnected,
    rpcUrl,
    signer,
    simulate,
    send,
    onTradeSuccess: handleTradeSuccess,
  })

  const debugController = useDebugController({
    rpcUrl,
    hasLoadedPools,
    loadPools,
  })
  const { debugLoading, debugError, recentSignatures, hasLoadedDebug, loadDebugData } = debugController

  useEffect(() => {
    if (
      activeTab !== 'Pools' &&
      activeTab !== 'Trade' &&
      activeTab !== 'Borrow' &&
      activeTab !== 'Positions'
    ) {
      return
    }

    if (hasLoadedPools) return
    void loadPools()
  }, [activeTab, hasLoadedPools, loadPools])

  useEffect(() => {
    if (activeTab !== 'Debug') return
    if (hasLoadedDebug) return
    void loadDebugData()
  }, [activeTab, hasLoadedDebug, loadDebugData])

  useEffect(() => {
    if (activeTab !== 'Positions' && activeTab !== 'Borrow' && activeTab !== 'Trade') return

    if (!isConnected || !account || !pools.length) {
      void loadPositionsData()
      return
    }

    void loadPositionsData()
  }, [account, activeTab, isConnected, loadPositionsData, pools.length])

  return (
    <main className="content">
      <section className="market-shell">
        <div className="market-shell-card">
          <div className="market-header market-header-empty" />

          <TabsNav activeTab={activeTab} onChange={setActiveTab} />

          <div className="market-content-card">
            {activeTab === 'Pools' && (
              <PoolsTab
                pools={pools}
                poolsLoading={poolsLoading}
                poolsError={poolsError}
              />
            )}

            {activeTab === 'Trade' && <TradeTab {...tradeController} />}

            {activeTab === 'Borrow' && <BorrowTab {...borrowController} />}

            {activeTab === 'Positions' && (
              <PositionsTab
                isConnected={isConnected}
                account={account ?? null}
                positionsLoading={positionsLoading}
                positionsError={positionsError}
                lpPositions={lpPositions}
                loanPositions={loanPositions}
                poolSymbolsByAddress={poolSymbolsByAddress}
                onRepayLoan={executeRepayLoan}
                onRemoveCollateral={executeRemoveCollateral}
              />
            )}

            {activeTab === 'Debug' && (
              <DebugTab
                rpcUrl={rpcUrl}
                debugLoading={debugLoading}
                debugError={debugError}
                poolAccounts={poolAccounts}
                recentSignatures={recentSignatures}
                loadDebugData={() => {
                  void loadDebugData()
                }}
              />
            )}

            {activeTab === 'Pools' && (
              <div className="market-footer">
                <button
                  className="link-button"
                  onClick={() => {
                    void loadPools()
                  }}
                  disabled={poolsLoading}
                >
                  {poolsLoading ? 'Refreshing Pools…' : 'Refresh Pools'}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

export default MarketsPage
