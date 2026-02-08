import { useEffect, useMemo, useState } from 'react'
import {
  buildHeatmap,
  fetchPoolsForHeatmap,
  type HeatmapCell,
  type HeatmapPoolPoint,
} from '../../lib/indexerClient'
import { formatCompact, shortAddress } from '../../lib/formatters'

function LiquidityHeatmap() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [points, setPoints] = useState<HeatmapPoolPoint[]>([])
  const [cells, setCells] = useState<HeatmapCell[]>([])
  const [selectedCellKey, setSelectedCellKey] = useState<string>('')
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const pools = await fetchPoolsForHeatmap({
          signal: controller.signal,
          force: refreshTick > 0,
        })
        if (!mounted) return

        const heatmap = buildHeatmap(pools)
        setPoints(heatmap.points)
        setCells(heatmap.cells)

        if (heatmap.cells.length > 0) {
          const topCell = [...heatmap.cells].sort((a, b) => b.poolCount - a.poolCount)[0]
          setSelectedCellKey((current) => current || `${topCell.x}-${topCell.y}`)
        }
      } catch (fetchError) {
        if (!mounted) return
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load liquidity heatmap')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void load()

    return () => {
      mounted = false
      controller.abort()
    }
  }, [refreshTick])

  const selectedCell = useMemo(() => {
    return cells.find((cell) => `${cell.x}-${cell.y}` === selectedCellKey) ?? null
  }, [cells, selectedCellKey])

  const rows = useMemo(() => {
    const list: HeatmapCell[][] = []
    for (let y = 4; y >= 0; y -= 1) {
      const row: HeatmapCell[] = []
      for (let x = 0; x < 5; x += 1) {
        const cell = cells.find((item) => item.x === x && item.y === y)
        if (cell) row.push(cell)
      }
      list.push(row)
    }
    return list
  }, [cells])

  return (
    <section className="debug-card liquidity-heatmap" aria-label="Liquidity heatmap">
      <div className="heatmap-head">
        <div>
          <h3>Liquidity Heatmap</h3>
          <p>Liquidity x volume concentration across pools (5x5 quantized)</p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setRefreshTick((current) => current + 1)}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="status-block error">{error}</div>}
      {!error && loading && !cells.length && <div className="status-block">Loading heatmap…</div>}
      {!error && !loading && !cells.length && <div className="status-block">No pools available for heatmap.</div>}

      {!!cells.length && (
        <div className="heatmap-layout">
          <div className="heatmap-grid-wrap">
            <div className="heatmap-y-label">Volume (low → high)</div>
            <div className="heatmap-grid" role="grid" aria-label="Liquidity heatmap grid">
              {rows.map((row, rowIndex) => (
                <div key={`row-${rowIndex}`} className="heatmap-row" role="row">
                  {row.map((cell) => {
                    const key = `${cell.x}-${cell.y}`
                    return (
                      <button
                        key={key}
                        type="button"
                        role="gridcell"
                        className={`heatmap-cell ${selectedCellKey === key ? 'active' : ''}`}
                        style={{
                          opacity: 0.2 + cell.intensity * 0.8,
                        }}
                        onClick={() => setSelectedCellKey(key)}
                        title={`Liquidity bucket ${cell.x + 1}, volume bucket ${cell.y + 1}`}
                      >
                        <span>{cell.poolCount}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="heatmap-x-label">Liquidity (low → high)</div>
          </div>

          <aside className="heatmap-sidebar">
            <h4>Top Pools</h4>
            <div className="heatmap-top-list">
              {points.slice(0, 8).map((point) => (
                <article key={point.poolAddress} className="heatmap-top-item">
                  <strong>{point.symbol}</strong>
                  <span>Liq {formatCompact(point.liquidityValue, 2)}</span>
                  <span>Vol {formatCompact(point.volumeValue, 2)}</span>
                  <code>{shortAddress(point.poolAddress)}</code>
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}

      {!!selectedCell && (
        <div className="heatmap-selected">
          <h4>Selected Cell Pools ({selectedCell.poolCount})</h4>
          {!selectedCell.pools.length && <div className="status-block">No pools in this cell.</div>}
          {!!selectedCell.pools.length && (
            <div className="heatmap-selected-list">
              {selectedCell.pools.map((point) => (
                <article key={point.poolAddress} className="heatmap-selected-item">
                  <strong>{point.symbol}</strong>
                  <span>Liq {formatCompact(point.liquidityValue, 2)}</span>
                  <span>Vol {formatCompact(point.volumeValue, 2)}</span>
                  <code>{shortAddress(point.poolAddress)}</code>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default LiquidityHeatmap
