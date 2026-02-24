import { getOmnipairIdlError, type OmnipairIdlError } from './errors.generated'

export type OmnipairErrorInfo = OmnipairIdlError & {
  hint?: string
}

const OMNIPAIR_ERROR_HINTS: Record<number, string> = {
  6010: 'Add collateral first (or borrow a smaller amount).',
  6013: 'The pool does not have enough reserves of this token right now.',
  6022: 'Add collateral or repay debt to restore health.',
  6025: 'Check your wallet balance and token account.',
  6027: 'Initialize your position first (e.g. add collateral) before borrowing.',
  6069: 'This pool is in reduce-only mode (repay/remove only).',
}

export function getOmnipairErrorInfo(code: number): OmnipairErrorInfo | null {
  const base = getOmnipairIdlError(code)
  if (!base) return null
  return {
    ...base,
    hint: OMNIPAIR_ERROR_HINTS[code],
  }
}

