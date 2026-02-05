import { useMemo, useState } from 'react'
import type { Address, Instruction } from '@solana/kit'
import { useSendSmartTransaction } from '../solana/useSendSmartTransaction'

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as Address

function createMemoInstruction(message: string): Instruction<Address> {
  return {
    programAddress: MEMO_PROGRAM,
    accounts: [],
    data: new TextEncoder().encode(message),
  }
}

export function TransactionSimulator() {
  const { simulate, send } = useSendSmartTransaction()
  const [message, setMessage] = useState('Omnipair test memo')
  const [status, setStatus] = useState('Idle')
  const [signature, setSignature] = useState('')
  const [units, setUnits] = useState<number | null>(null)
  const [error, setError] = useState('')

  const instructions = useMemo(() => [createMemoInstruction(message)], [message])

  const handleSimulate = async () => {
    setStatus('Simulating…')
    setSignature('')
    setError('')
    setUnits(null)

    try {
      const res = await simulate(instructions)
      const consumed = res?.value?.unitsConsumed ? Number(res.value.unitsConsumed) : null
      setUnits(consumed)
      setStatus(consumed ? `Simulated (${consumed} units)` : 'Simulated')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Simulation failed. Check console for details.'
      setError(message)
      setStatus('Simulation failed')
    }
  }

  const handleSend = async () => {
    setStatus('Sending…')
    setSignature('')
    setError('')
    setUnits(null)

    try {
      const sig = await send(instructions)
      setSignature(sig)
      setStatus('Sent')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Send failed. Check console for details.'
      setError(message)
      setStatus('Send failed')
    }
  }

  return (
    <div className="simulator">
      <label className="field">
        <span className="field-label">Memo message</span>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="field-input"
          placeholder="Type a memo to simulate"
        />
      </label>

      <div className="simulator-actions">
        <button className="primary-button" onClick={handleSimulate}>
          Simulate Transaction
        </button>
        <button className="ghost-button" onClick={handleSend}>
          Send Transaction
        </button>
      </div>

      <div className="simulator-status">
        <span className="status-pill">{status}</span>
        {units !== null && <span className="status-note">Units: {units}</span>}
      </div>

      {signature && (
        <div className="status-block">
          <span className="status-title">Signature</span>
          <code>{signature}</code>
        </div>
      )}

      {error && (
        <div className="status-block error">
          <span className="status-title">Error</span>
          <p>{error}</p>
        </div>
      )}
    </div>
  )
}
