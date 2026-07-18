# Allowance Revoker

**Find every token approval your wallet has ever granted on Monad, see which ones are actually dangerous, and revoke them — with each cleanup provable on-chain.**

Built for the [Spark hackathon](https://buildanything.so/hackathons/spark). Monad Mainnet, chain 143.

- **Live app:** _(add your Vercel URL)_
- **RevokeRegistry contract:** _(add address after deploy)_
- **Demo video:** _(add link)_

---

## The problem

Every time you use a dApp, you approve it to move your tokens. Usually for an unlimited amount. Always with no expiry.

Months later you have forgotten which apps still hold that permission. The approval outlives the session, the trade, and often the protocol itself. If any one of those contracts is exploited — or was malicious from the start — the attacker does not need your private key. They just use the allowance you already signed.

I went looking for what my own wallet was still exposed to and found approvals I had no memory of granting. There was no easy way to see the whole list on Monad, so I built one.

## What it does

1. **Scan** — reads every `Approval` and `ApprovalForAll` event your wallet has ever emitted, back to genesis.
2. **Verify** — re-reads each candidate against live chain state. Approvals that were spent, reduced, or revoked drop out, as does the very large amount of outright spam (see below).
3. **Score** — grades what remains by how much it actually exposes, with every point traceable to a stated reason.
4. **Revoke** — sets the allowance to zero, then proves the cleanup on-chain.

Everything on screen comes from a live RPC call against Monad mainnet. There is no seeded data, no mock mode, and no backend.

## The on-chain part: `RevokeRegistry`

Revoking an approval is just `approve(spender, 0)` sent to the token — only the owner can change their own allowance, so no third-party contract can do it for you. The contract's job is different: making a cleanup **verifiable** afterwards.

The obvious way to do that does not work, and it is worth being explicit about why. A single `logRevoke(token, spender)` that checks `allowance(msg.sender, spender) == 0` proves nothing, because **allowance is zero by default for every pair that never had an approval.** Anyone could call it against unlimited random addresses and mint an unbounded score.

So a revocation is proven across two transactions that bracket your own `approve(spender, 0)`:

| Step | What happens | What it proves |
|---|---|---|
| `arm(kind, token, spender)` | Contract reads the **live** allowance itself and **requires it to be nonzero**, then snapshots it | The approval genuinely existed |
| *your revoke* | `approve(spender, 0)` sent straight to the token | — |
| `confirm(kind, token, spender)` | Contract requires the snapshot **and** requires the allowance to now be **zero** | It was genuinely revoked |

Both reads are made by the contract against the real token at call time, so neither side can be self-reported. `armBatch` / `confirmBatch` mean N revocations cost 2 extra transactions rather than 2N.

`cleanupScore` is credited **at most once per `(user, token, spender)` triple**, so a pair cannot be cycled for points.

**An honest limit:** this proves an allowance existed and was zeroed for the token address you name. It cannot prove that token is *worth* anything — anyone can deploy a worthless ERC-20, approve it, and revoke it. Any public leaderboard built on this should additionally filter to the canonical Monad token list. The contract does not claim more than the chain can actually prove.

No owner, no admin keys, no upgradeability, and it never takes custody of anything.

## Things that turned out to be true on Monad

Most of the design here was forced by measurements against live mainnet rather than chosen up front. Recording them because they cost real time to discover:

**The RPC endpoint is load-bearing.** Finding every approval means one `eth_getLogs` spanning all history. Monad's public endpoints disagree about whether that is allowed:

| Endpoint | Provider | `eth_getLogs` limit |
|---|---|---|
| `rpc.monad.xyz` | QuickNode | **100 blocks** |
| `rpc3.monad.xyz` | Ankr | 1,000 blocks |
| `rpc1.monad.xyz` | Alchemy | **any range**, capped at 10,000 logs |

At ~88.5M blocks, the 100-block cap needs ~885,000 sequential requests. Only the response-size model is workable, so log queries are pinned to `rpc1` and deliberately **never** fall back — falling back to a capped endpoint mid-scan would silently return a partial list, which is worse than failing.

**Most approval logs are spam.** One sampled wallet had **372 logged "approvals" of which zero were real** — every one came from a contract that emits `Approval` events without implementing `allowance()` at all, purely to appear in wallet UIs. This is why logs are only ever used to find candidates, never as the answer.

**ERC-20 and ERC-721 share the `Approval` topic0.** They are told apart by topic count (ERC-20 indexes 2 args, ERC-721 indexes 3). Without that filter, every NFT approval surfaces as a bogus token row.

**Heavy wallets exceed the log cap.** The fallback walks backwards in windows calibrated from the range the provider suggests in its own error message, five at a time, and reports exactly how far back it reached instead of implying full coverage. Typical scan: 1–5s. Worst case seen: ~33s.

## Risk scoring

Deliberately simple, additive, and inspectable — the whole model is one short file, [`web/lib/riskScore.ts`](web/lib/riskScore.ts).

| Signal | Points |
|---|---|
| Unlimited allowance (≥ 2²⁰⁰) or NFT approval-for-all | 50 |
| Spender not on the known-protocol list | 15 |
| Approval older than 6 months (3 months) | 10 (5) |
| Token not on the canonical Monad token list | 5 |

**60+ high · 30–59 medium · under 30 low.** Every row can be expanded to see exactly which signals fired and why.

Exposure dominates on purpose: it is the one signal read directly from chain state rather than inferred, and it determines how much can actually be taken. The known-spender list is weighted low because it is short and hand-maintained — a miss says more about the list than about the spender. An earlier weighting flagged every legitimate Curvance and Euler vault as medium risk, which is exactly the kind of false confidence a security tool should not manufacture.

The threshold for "unlimited" is 2²⁰⁰ rather than exactly `uint256` max, because routers often approve max/2 or max-minus-spent, and those are just as dangerous but would slip past an equality check.

## Running it locally

**Prerequisites:** Node 20.9+, and [Foundry](https://getfoundry.sh) if you want to build or deploy the contract.

```bash
git clone --recurse-submodules <repo-url>
cd allowance-revoker
```

### Frontend

```bash
cd web
npm install
cp .env.example .env.local     # optional: set NEXT_PUBLIC_REGISTRY_ADDRESS
npm run dev                    # http://localhost:3000
```

It works with no configuration at all. Without a registry address, scanning and revoking behave normally and the UI states plainly that on-chain proofs are disabled.

**You do not need a wallet to try it.** Paste any address into the read-only inspector on the landing page, or deep-link it:

```
http://localhost:3000/?address=0x8F10B468b06c6FD214B65F87778827F7D113f996
```

That is a real mainnet wallet with 91 live approvals, most of them unlimited.

### Contract

```bash
cd contracts
forge build
forge test -vv          # 18 tests
```

Deploy to Monad mainnet:

```bash
cast wallet import monad-deployer --interactive   # paste key at the prompt

forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://rpc.monad.xyz \
  --account monad-deployer \
  --broadcast

forge verify-contract <ADDRESS> RevokeRegistry \
  --chain 143 \
  --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/
```

Then put the address in `web/.env.local` as `NEXT_PUBLIC_REGISTRY_ADDRESS`.

> `evm_version = "prague"` and `solc 0.8.28` in `foundry.toml` are required for Monad. Do not lower them.

## Layout

```
contracts/
  src/RevokeRegistry.sol      the two-phase revocation proof
  test/RevokeRegistry.t.sol   18 tests, incl. the farming attack the naive design allows
  script/Deploy.s.sol
web/
  lib/scanApprovals.ts        log scanning, spam filtering, live re-verification
  lib/riskScore.ts            the entire risk model
  lib/useRevoke.ts            arm -> revoke -> confirm, with independent verification
  lib/chain.ts                RPC selection and why it matters
  components/ApprovalTable.tsx
  app/page.tsx                dashboard
```

## Tests

```bash
cd contracts && forge test -vv
```

18 passing. The ones that matter most are `test_CannotScoreApprovalThatNeverExisted` and `test_CannotFarmScoreAcrossManyRandomSpenders`, which reproduce the attack a single-step registry permits and assert the score stays at zero.

### Verifying the revoke flow end to end

Unit tests cover the contract, but the part worth proving is the whole path: browser → wallet → three transactions → chain. That runs against a local node, so it needs no funds and no wallet of your own:

```bash
./scripts/local-e2e.sh
cd web && npm run dev
```

The script starts anvil **as chain 143**, so the dashboard treats it as Monad; installs Multicall3 by copying its runtime bytecode from mainnet; deploys the registry and a mock token; and grants an unlimited approval. Import the printed anvil account into a browser wallet, connect, and revoke the approval it shows.

Then confirm the chain agrees, rather than trusting the UI:

```bash
cast call $TOKEN 'allowance(address,address)(uint256)' $OWNER $SPENDER --rpc-url http://localhost:8545  # 0
cast call $REGISTRY 'cleanupScore(address)(uint256)' $OWNER --rpc-url http://localhost:8545             # 1
```

Two things this turned up that unit tests could not: the app hard-depends on Multicall3 being deployed (without it every approval is silently discarded as dead), and the block-rate sample used for approval age underflowed on any chain shorter than 100,000 blocks.

## Limitations

Stated plainly, because a security tool that oversells itself is worse than none:

- **The known-spender list has 5 entries.** Almost every real protocol will show as "unrecognised". That is weighted low for exactly this reason, but it is still the weakest input to the score.
- **Very high-activity wallets get partial coverage.** The scanner stops at a request budget and reports the exact block it reached. It never claims full coverage it did not achieve.
- **Approval age is approximate**, derived from an observed block rate rather than per-block timestamps.
- **Batch revocation is not implemented.** `approve` is `msg.sender`-scoped so Multicall3 cannot help, and Permit2's `lockdown()` only clears Permit2's *own* internal allowances — it cannot touch an approval granted directly to another spender. The real answer is EIP-5792 `wallet_sendCalls` (Monad supports EIP-7702 natively), gated on a runtime `wallet_getCapabilities` check.
- **Tokens whose `allowance()` reverts are dropped**, not surfaced. They are overwhelmingly spam, but a genuinely broken token would be hidden too.

## License

MIT
