import { useEffect, useRef, useState } from 'react'
import { DEFAULT_TRADE_TOKEN, type TradeTokenOption } from '../../features/market/types'

type TokenSelectProps = {
  id?: string
  value: string
  options: TradeTokenOption[]
  onChange: (value: string) => void
  disabled?: boolean
  ariaLabel: string
}

function TokenIcon({ token }: { token: TradeTokenOption }) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = Boolean(token.logoUrl) && !imageFailed

  return (
    <span className="trade-token-logo" style={{ background: token.color }} aria-hidden>
      {showImage ? (
        <img
          src={token.logoUrl ?? ''}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        token.logo
      )}
    </span>
  )
}

function TokenSelect({
  id,
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}: TokenSelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const selected = options.find((token) => token.mint === value) ?? options[0] ?? DEFAULT_TRADE_TOKEN

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
      className={`token-select ${menuOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
    >
      <button
        id={id}
        type="button"
        className="token-select-trigger"
        onClick={() => {
          if (disabled || !options.length) return
          setOpen((current) => !current)
        }}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <TokenIcon token={selected} />
        <span className="trade-token-label">{selected.ticker}</span>
        <span className="token-select-caret" aria-hidden>
          ▾
        </span>
      </button>

      {menuOpen && (
        <div className="token-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((token) => (
            <button
              key={token.mint}
              type="button"
              role="option"
              aria-selected={token.mint === selected.mint}
              className={`token-select-option ${token.mint === selected.mint ? 'active' : ''}`}
              onClick={() => {
                onChange(token.mint)
                setOpen(false)
              }}
            >
              <TokenIcon token={token} />
              <span className="token-option-text">
                <span className="token-option-main">{token.ticker}</span>
                <span className="token-option-sub">{token.name}</span>
              </span>
            </button>
          ))}
          {!options.length && <div className="token-select-empty">No tokens available</div>}
        </div>
      )}
    </div>
  )
}

export default TokenSelect
