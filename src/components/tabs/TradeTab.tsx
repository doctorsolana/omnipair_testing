import TokenSelect from '../common/TokenSelect'
import type { TradeTokenOption } from '../../features/market/types'

type TradeTabProps = {
  tradeTokenOptions: TradeTokenOption[]
  tradeFromAmount: string
  tradeToAmount: string
  tradeFromToken: string
  tradeToToken: string
  tradeError: string | null
  tradeStatus: string | null
  tradeSubmitting: boolean
  hasDirectPool: boolean
  setTradeFromAmount: (value: string) => void
  setTradeToAmount: (value: string) => void
  setTradeFromToken: (value: string) => void
  setTradeToToken: (value: string) => void
  switchTradeDirection: () => void
  executeTrade: () => void
}

function TradeTab({
  tradeTokenOptions,
  tradeFromAmount,
  tradeToAmount,
  tradeFromToken,
  tradeToToken,
  tradeError,
  tradeStatus,
  tradeSubmitting,
  hasDirectPool,
  setTradeFromAmount,
  setTradeToAmount,
  setTradeFromToken,
  setTradeToToken,
  switchTradeDirection,
  executeTrade,
}: TradeTabProps) {
  return (
    <div className="trade-shell">
      <section className="trade-card">
        {!tradeTokenOptions.length && <div className="status-block">Load pools first to enable trading.</div>}

        <div className="trade-field">
          <label htmlFor="trade-from-amount">From</label>
          <div className="trade-input-wrap">
            <input
              id="trade-from-amount"
              className="trade-input"
              value={tradeFromAmount}
              onChange={(event) => setTradeFromAmount(event.target.value)}
              inputMode="decimal"
            />
            <TokenSelect
              value={tradeFromToken}
              options={tradeTokenOptions}
              onChange={setTradeFromToken}
              ariaLabel="Select token to swap from"
              disabled={!tradeTokenOptions.length}
            />
          </div>
        </div>

        <button
          type="button"
          className="trade-switch"
          onClick={switchTradeDirection}
          aria-label="Switch token direction"
        >
          ↕
        </button>

        <div className="trade-field">
          <label htmlFor="trade-to-amount">To</label>
          <div className="trade-input-wrap">
            <input
              id="trade-to-amount"
              className="trade-input"
              value={tradeToAmount}
              onChange={(event) => setTradeToAmount(event.target.value)}
              inputMode="decimal"
            />
            <TokenSelect
              value={tradeToToken}
              options={tradeTokenOptions}
              onChange={setTradeToToken}
              ariaLabel="Select token to swap to"
              disabled={!tradeTokenOptions.length}
            />
          </div>
        </div>

        {tradeError && <div className="status-block error">{tradeError}</div>}
        {tradeStatus && <div className="status-block">{tradeStatus}</div>}
        {!tradeError && tradeFromToken && tradeToToken && !hasDirectPool && (
          <div className="status-block">No direct pool found for selected token pair.</div>
        )}

        <button
          type="button"
          className="trade-submit"
          onClick={executeTrade}
          disabled={tradeSubmitting || !tradeTokenOptions.length || !tradeFromToken || !tradeToToken}
        >
          {tradeSubmitting ? 'Submitting…' : 'Place Swap'}
        </button>
      </section>
    </div>
  )
}

export default TradeTab
