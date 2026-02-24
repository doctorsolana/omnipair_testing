# Omnipair Test UI

This is a test UI for exploring Omnipair and understanding how pools, swaps, borrowing, and positions behave.

## Architecture

The app is organized feature-first:

- `src/app`: shell + routing
- `src/pages`: route-level pages
- `src/features`: domain slices (`pools`, `trade`, `borrow`, `positions`, `debug`, `poolDetail`, `newPool`)
- `src/integrations`: wallet/RPC and indexer adapters
- `src/protocol/omnipair`: Codama-generated protocol SDK + curated exports
- `src/shared`: reusable UI primitives and utilities

## Regenerate Omnipair SDK

```bash
pnpm sdk:refresh
```

Or step-by-step:

```bash
pnpm idl:fetch
pnpm codama:gen
pnpm build
```
