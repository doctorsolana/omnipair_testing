import type { Address } from '@solana/kit'
import { OMNIPAIR_PROGRAM_ADDRESS } from './generated/programs'

export * from './generated/accounts'
export * from './generated/errors'
export * from './generated/instructions'
export * from './generated/programs'
export * from './generated/shared'
export * from './generated/types'

export const OMNIPAIR_PROGRAM_ID = OMNIPAIR_PROGRAM_ADDRESS as Address
