import type { Address } from '@solana/kit'
import { OMNIPAIR_PROGRAM_ADDRESS } from './generated/programs/omnipair'

export { getPairDecoder, type Pair } from './generated/accounts/pair'
export { getRateModelSize } from './generated/accounts/rateModel'
export { getUserPositionDecoder, type UserPosition } from './generated/accounts/userPosition'

export { getAddLiquidityInstructionAsync } from './generated/instructions/addLiquidity'
export { getAddCollateralInstructionAsync } from './generated/instructions/addCollateral'
export { getBorrowInstructionAsync } from './generated/instructions/borrow'
export { getInitializeInstructionAsync } from './generated/instructions/initialize'
export { getRemoveCollateralInstructionAsync } from './generated/instructions/removeCollateral'
export { getRepayInstructionAsync } from './generated/instructions/repay'
export { getRemoveLiquidityInstructionAsync } from './generated/instructions/removeLiquidity'
export { getSwapInstructionAsync } from './generated/instructions/swap'

export * from './constants'
export * from './errors'

export const OMNIPAIR_PROGRAM_ID = OMNIPAIR_PROGRAM_ADDRESS as Address
