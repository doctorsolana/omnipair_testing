import type { Address } from "@solana/kit";
import {
  OMNIPAIR_PROGRAM_ADDRESS,
} from "../generated/omnipair/programs";

export * from "../generated/omnipair/accounts";
export * from "../generated/omnipair/errors";
export * from "../generated/omnipair/instructions";
export * from "../generated/omnipair/programs";
export * from "../generated/omnipair/shared";
export * from "../generated/omnipair/types";

export const OMNIPAIR_PROGRAM_ID = OMNIPAIR_PROGRAM_ADDRESS as Address;
