import { useCallback } from 'react'
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
} from '@solana/kit'
import { useConnector, useKitTransactionSigner } from '@solana/connector'
import { useRpc } from './useRpc'

const COMPUTE_UNIT_BUFFER = 1.15
const DEFAULT_COMPUTE_UNITS = 200_000
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111' as Address

function createSetComputeUnitLimitInstruction(units: number): Instruction<Address> {
  const data = new Uint8Array(5)
  data[0] = 2
  data[1] = units & 0xff
  data[2] = (units >> 8) & 0xff
  data[3] = (units >> 16) & 0xff
  data[4] = (units >> 24) & 0xff

  return {
    programAddress: COMPUTE_BUDGET_PROGRAM,
    accounts: [],
    data,
  }
}

export function useSendSmartTransaction(): {
  simulate: (instructions: Instruction<Address>[]) => Promise<any>
  send: (instructions: Instruction<Address>[]) => Promise<string>
  signer: any
} {
  const { rpc } = useRpc()
  const { isConnected } = useConnector()
  const { signer, ready } = useKitTransactionSigner()

  const buildEncodedTransaction = useCallback(
    async (instructions: Instruction<Address>[], latestBlockhash: any) => {
      const message = pipe(
        createTransactionMessage({ version: 'legacy' }),
        (m) => setTransactionMessageFeePayerSigner(signer as any, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstructions(instructions, m),
      )
      const compiledTx = compileTransaction(message)
      const transactionEncoder = getTransactionEncoder()
      const transactionBytes = transactionEncoder.encode(compiledTx)
      return {
        message,
        base64: btoa(String.fromCharCode(...transactionBytes)),
      }
    },
    [signer],
  )

  const simulate = useCallback(
    async (instructions: Instruction<Address>[]) => {
      if (!isConnected || !ready || !signer) throw new Error('Wallet not connected')
      if (!instructions?.length) throw new Error('No instructions provided')

      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send()
      const { base64 } = await buildEncodedTransaction(instructions, latestBlockhash)

      return rpc
        .simulateTransaction(base64 as any, {
          encoding: 'base64',
          commitment: 'confirmed',
          sigVerify: false,
        })
        .send()
    },
    [rpc, isConnected, ready, signer, buildEncodedTransaction],
  )

  const send = useCallback(
    async (instructions: Instruction<Address>[]) => {
      if (!isConnected || !ready || !signer) throw new Error('Wallet not connected')
      if (!instructions?.length) throw new Error('No instructions provided')

      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send()

      let computeLimit = Math.ceil(DEFAULT_COMPUTE_UNITS * COMPUTE_UNIT_BUFFER)

      try {
        const { base64: simBase64 } = await buildEncodedTransaction(instructions, latestBlockhash)
        const simResult = await rpc
          .simulateTransaction(simBase64 as any, {
            encoding: 'base64',
            commitment: 'confirmed',
            sigVerify: false,
          })
          .send()

        if (!simResult?.value?.err && simResult?.value?.unitsConsumed) {
          const unitsConsumed = Number(simResult.value.unitsConsumed)
          computeLimit = Math.ceil(unitsConsumed * COMPUTE_UNIT_BUFFER)
        }
      } catch {
        // fallback to default compute units
      }

      const computeIx = createSetComputeUnitLimitInstruction(computeLimit)
      const finalInstructions = [computeIx, ...instructions]

      const message = pipe(
        createTransactionMessage({ version: 'legacy' }),
        (m) => setTransactionMessageFeePayerSigner(signer as any, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstructions(finalInstructions, m),
      )

      const signedTransaction = await signTransactionMessageWithSigners(message)
      const transactionEncoder = getTransactionEncoder()
      const transactionBytes = transactionEncoder.encode(signedTransaction)
      const transactionBase64 = btoa(String.fromCharCode(...transactionBytes))

      const signature = await rpc
        .sendTransaction(transactionBase64 as any, {
          encoding: 'base64',
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        })
        .send()

      return signature as string
    },
    [rpc, isConnected, ready, signer, buildEncodedTransaction],
  )

  return { simulate, send, signer }
}
