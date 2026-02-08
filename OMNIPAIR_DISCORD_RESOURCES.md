# Omnipair Discord Notes (Actionable References)

## Core Interfaces
- Published program interface (IDL package): [@omnipair/program-interface](https://www.npmjs.com/package/@omnipair/program-interface)
- Historical indexer API root: [https://api.indexer.omnipair.fi/](https://api.indexer.omnipair.fi/)
  - Note: root path is documented per Omnicore team.

## Data Available from Indexer API
- Prices / price history
- LP positions
- Borrow positions
- Pools with time-based simulations (including accrued interest)
- Event-style historical data

## Realtime Swaps (Streaming)
- gRPC endpoint: [https://grpc.indexer.omnipair.fi/](https://grpc.indexer.omnipair.fi/)
- Public repo (gRPC implementation): [omnipair/omnipair-indexer/grpc](https://github.com/omnipair/omnipair-indexer/tree/main/grpc)
  - Note: not documented yet, but source is public.

## Pool Creation Requirement
- LP mint must be vanity/grinded before creating pool.
- Vanity service: [https://vanity.omnipair.fi/](https://vanity.omnipair.fi/)
- Example grind request:
  - [https://vanity.omnipair.fi/grind?suffix=omfg](https://vanity.omnipair.fi/grind?suffix=omfg)
- Example resulting mint suffix:
  - `A2uzkjFdXGE1yu7AaTwvedW7cG575ePtr8dcKvcdomfg`

## Vanity Tooling (Self-host)
- Vanity server repo: [omnipair/vanity-server](https://github.com/omnipair/vanity-server)

## Testing Guidance from Omnicore
- Use mock tokens for testing.
- Team plans cleanup after testing, so avoid relying on long-term persistence of test pools.

## Extra Reference Shared by Omnicore
- Example metadata/setup gist:
  - [https://gist.github.com/elrakabawi/5135522ec41cd29a875a49f1430081c6](https://gist.github.com/elrakabawi/5135522ec41cd29a875a49f1430081c6)

## Suggested Internal Follow-ups
- Add indexer API integration for:
  - pool history and utilization timelines
  - LP/borrow position views
  - richer trade context (recent swaps / historical data)
- Add optional gRPC consumer for live swap feed.
- Add pool creation pre-check:
  - validate LP mint vanity/grind requirements before submit.
