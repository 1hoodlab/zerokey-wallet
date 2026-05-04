# UsdcTransparentEscrow (Hardhat)

Minimal **transparent ERC-20 escrow**: stake tokens sit in **contract balance** (visible on BscScan/Testnet explorers). Withdrawals emit **`EscrowWithdraw`**. There is **no** prediction-market math on-chain; your bot/database remains the source of truth for payouts (MVP aligns with [`docs/superpowers/specs/2026-05-04-telegram-binary-polls-design.md`](../docs/superpowers/specs/2026-05-04-telegram-binary-polls-design.md)).

## Why contract instead of stuffing `POLL_USDC_ESCROW_ADDRESS` as bare EOA

- Treasury **does not physically sit in** the deploy/server key’s **EOA ERC-20 balances** once users `transfer()` into **this contract**.
- Operators still need **`owner`** to call `withdraw` for payouts — use **`ESCROW_OWNER_ADDRESS` = multisig** (Gnosis Safe, etc.) so no single hot app key holds **withdraw rights** to the whole pool (production pattern).

## Setup

From repo root:

```bash
pnpm install
cd contracts
cp .env.example .env
# fill DEPLOYER_PRIVATE_KEY (funded with tBNB for gas) and ideally ESCROW_OWNER_ADDRESS
```

Compile:

```bash
pnpm run compile
```

## Deploy BSC Testnet (chainId 97)

```bash
pnpm run deploy:bsc-testnet
```

Copy printed address into your app’s **`POLL_USDC_ESCROW_ADDRESS`** (or `Network` row). User stakes use normal **USDC `transfer(escrow, amount)`** to this contract.

## Payout integration (Nest app — follow-up)

Replace “EOA signs `ERC20.transfer`” with **owner** calling:

`withdraw(IERC20 usdc, address winnerSmartAccount, uint256 amount, bytes32 memo)`

Use the same **USDC contract** your `Network.usdcAddress` points to. `memo` can be `keccak256(pollId || payoutId)` for off-chain audit trails.

## Security notes

- **Owner compromise = fund drain** (same class of risk as any upgradable-less custodial pattern). Mitigate with **multisig owner**, **hardware signers**, and **least-privilege** keys on servers.
- Contract **rejects native BNB** via `receive()` revert; fund **owner** with tBNB only for **withdraw** gas (stake side still uses user gas as today).
