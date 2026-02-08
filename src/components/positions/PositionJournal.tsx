import { useEffect, useMemo, useState } from 'react'
import { fetchWalletJournal, type WalletJournalResult } from '../../lib/indexerClient'
import { formatIsoDay, formatTime, shortAddress } from '../../lib/formatters'
import type { JournalEntry } from '../../lib/journalTransform'

type PositionJournalProps = {
  isConnected: boolean
  walletAddress?: string
  poolSymbols: Record<string, string>
}

function eventLabel(type: JournalEntry['type']) {
  if (type === 'swap') return 'Swap'
  if (type === 'liquidity') return 'Liquidity'
  return 'Lending'
}

function PositionJournal({ isConnected, walletAddress, poolSymbols }: PositionJournalProps) {
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!isConnected || !walletAddress) {
      setEntries([])
      setErrors([])
      return
    }

    const controller = new AbortController()
    let mounted = true

    const load = async () => {
      setLoading(true)
      setErrors([])

      try {
        const result: WalletJournalResult = await fetchWalletJournal(walletAddress, {
          signal: controller.signal,
          force: refreshTick > 0,
        })

        if (!mounted) return
        setEntries(result.entries)
        setErrors(result.errors)
      } catch (fetchError) {
        if (!mounted) return
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
        setEntries([])
        setErrors([
          fetchError instanceof Error ? fetchError.message : 'Unable to load wallet activity timeline',
        ])
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void load()

    return () => {
      mounted = false
      controller.abort()
    }
  }, [isConnected, refreshTick, walletAddress])

  const grouped = useMemo(() => {
    const map = new Map<string, JournalEntry[]>()

    for (const entry of entries) {
      const dayKey = formatIsoDay(entry.timestamp)
      const bucket = map.get(dayKey)
      if (bucket) {
        bucket.push(entry)
      } else {
        map.set(dayKey, [entry])
      }
    }

    return [...map.entries()]
  }, [entries])

  return (
    <section className="positions-section position-journal" aria-label="Position journal">
      <header className="positions-head">
        <h3>Position Journal</h3>
        <div className="journal-head-actions">
          <span>{entries.length}</span>
          <button
            type="button"
            className="ghost-button journal-refresh"
            onClick={() => setRefreshTick((current) => current + 1)}
            disabled={!isConnected || !walletAddress || loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {!isConnected && <div className="status-block">Connect wallet to load your timeline.</div>}
      {isConnected && loading && !entries.length && <div className="status-block">Loading wallet activity…</div>}
      {isConnected && !loading && !entries.length && !errors.length && (
        <div className="status-block">No wallet events found yet.</div>
      )}
      {errors.length > 0 && (
        <div className="status-block error">
          {errors.map((error) => (
            <span key={error}>{error}</span>
          ))}
        </div>
      )}

      {!!grouped.length && (
        <div className="journal-feed">
          {grouped.map(([dayLabel, dayEntries]) => (
            <div key={dayLabel} className="journal-day-group">
              <div className="journal-day-label">{dayLabel}</div>
              <div className="journal-day-items">
                {dayEntries.map((entry) => (
                  <article key={entry.id} className="journal-item">
                    <div className="journal-item-top">
                      <span className={`journal-chip chip-${entry.type}`}>{eventLabel(entry.type)}</span>
                      <strong>{entry.title}</strong>
                      <span>{formatTime(entry.timestamp)}</span>
                    </div>
                    <div className="journal-item-mid">
                      <span>{poolSymbols[entry.poolAddress] || shortAddress(entry.poolAddress)}</span>
                      <span>{entry.subtitle}</span>
                    </div>
                    <div className="journal-item-bottom">
                      <span>{entry.amountSummary}</span>
                      <code>{shortAddress(entry.txSignature || 'unknown')}</code>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default PositionJournal
