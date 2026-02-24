import bs58 from 'bs58'
import { PAIR_DISCRIMINATOR } from './generated/accounts/pair'

// Shared protocol constants used across app callsites and PDA derivations.
export const PAIR_DISCRIMINATOR_BYTES = Uint8Array.from(PAIR_DISCRIMINATOR)
export const PAIR_DISCRIMINATOR_B58 = bs58.encode(PAIR_DISCRIMINATOR_BYTES)

export const PAIR_SEED_PREFIX = new Uint8Array([
  103, 97, 109, 109, 95, 112, 97, 105, 114,
])

export const POSITION_SEED_PREFIX = new Uint8Array([
  103, 97, 109, 109, 95, 112, 111, 115, 105, 116, 105, 111, 110,
])

export const RESERVE_VAULT_SEED_PREFIX = new Uint8Array([
  114, 101, 115, 101, 114, 118, 101, 95, 118, 97, 117, 108, 116,
])

export const COLLATERAL_VAULT_SEED_PREFIX = new Uint8Array([
  99, 111, 108, 108, 97, 116, 101, 114, 97, 108, 95, 118, 97, 117, 108, 116,
])

export const FUTARCHY_AUTHORITY_SEED_PREFIX = new Uint8Array([
  102, 117, 116, 97, 114, 99, 104, 121, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121,
])

export const METADATA_SEED_PREFIX = new Uint8Array([109, 101, 116, 97, 100, 97, 116, 97])

export const EVENT_AUTHORITY_SEED_PREFIX = new Uint8Array([
  95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121,
])
