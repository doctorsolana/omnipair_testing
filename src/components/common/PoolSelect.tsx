import { useEffect, useRef, useState } from 'react'
import type { PoolSelectOption } from '../../features/market/types'
import PoolLogo from './PoolLogo'

type PoolSelectProps = {
  id?: string
  value: string
  options: PoolSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  ariaLabel: string
}

function PoolSelect({
  id,
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}: PoolSelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const selected = options.find((pool) => pool.address === value) ?? options[0] ?? null

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && containerRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [open])

  const menuOpen = open && !disabled && options.length > 0

  return (
    <div
      ref={containerRef}
      className={`token-select pool-select ${menuOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
    >
      <button
        id={id}
        type="button"
        className="token-select-trigger pool-select-trigger"
        onClick={() => {
          if (disabled || !options.length) return
          setOpen((current) => !current)
        }}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span className="pool-logo-stack pool-select-logos" aria-hidden>
          <PoolLogo
            className="pool-logo"
            logoUrl={selected?.token0LogoUrl ?? null}
            fallback={selected?.token0Ticker.slice(0, 1) ?? 'T'}
            alt={`${selected?.token0Ticker ?? 'Token'} logo`}
          />
          <PoolLogo
            className="pool-logo pool-logo-secondary"
            logoUrl={selected?.token1LogoUrl ?? null}
            fallback={selected?.token1Ticker.slice(0, 1) ?? 'K'}
            alt={`${selected?.token1Ticker ?? 'Token'} logo`}
          />
        </span>
        <span className="trade-token-label pool-select-label">{selected?.symbol ?? 'Select Pool'}</span>
        <span className="token-select-caret" aria-hidden>
          ▾
        </span>
      </button>

      {menuOpen && (
        <div className="token-select-menu pool-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((pool) => (
            <button
              key={pool.address}
              type="button"
              role="option"
              aria-selected={pool.address === selected?.address}
              className={`token-select-option pool-select-option ${
                pool.address === selected?.address ? 'active' : ''
              }`}
              onClick={() => {
                onChange(pool.address)
                setOpen(false)
              }}
            >
              <span className="pool-logo-stack pool-select-logos" aria-hidden>
                <PoolLogo
                  className="pool-logo"
                  logoUrl={pool.token0LogoUrl}
                  fallback={pool.token0Ticker.slice(0, 1)}
                  alt={`${pool.token0Ticker} logo`}
                />
                <PoolLogo
                  className="pool-logo pool-logo-secondary"
                  logoUrl={pool.token1LogoUrl}
                  fallback={pool.token1Ticker.slice(0, 1)}
                  alt={`${pool.token1Ticker} logo`}
                />
              </span>
              <span className="token-option-text">
                <span className="token-option-main">{pool.symbol}</span>
                <span className="token-option-sub">{pool.name}</span>
              </span>
            </button>
          ))}
          {!options.length && <div className="token-select-empty">No pools available</div>}
        </div>
      )}
    </div>
  )
}

export default PoolSelect
