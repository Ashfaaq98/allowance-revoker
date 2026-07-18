import {createPublicClient, defineChain, fallback, http} from "viem";
import {monad} from "viem/chains";

export const MONAD = monad;
export const MONAD_CHAIN_ID = 143;

/**
 * RPC selection matters a great deal here, and not for the usual reasons.
 *
 * Finding every approval a wallet has ever granted means one `eth_getLogs` call spanning all
 * of chain history. Monad's public endpoints disagree sharply about whether that is allowed:
 *
 *   rpc.monad.xyz (QuickNode)  -> hard error, "eth_getLogs is limited to a 100 range"
 *   rpc3.monad.xyz (Ankr)      -> hard error, "Block range is too large" above 1,000
 *   rpc1.monad.xyz (Alchemy)   -> ANY block range, capped instead at 10,000 logs per response
 *
 * At ~88.5M blocks, the 100-block cap would need ~885,000 sequential requests. Only the
 * response-size model is workable, so log queries are pinned to rpc1 and the scanner splits
 * the range when a wallet trips the 10,000-log cap (see scanApprovals.ts).
 */
export const LOGS_RPC = "https://rpc1.monad.xyz";

/** Ordinary calls and transactions are fine on any endpoint; these are only rate-limited. */
const GENERAL_RPCS = ["https://rpc1.monad.xyz", "https://rpc.monad.xyz", "https://rpc3.monad.xyz"];

export const monadWithRpc = defineChain({
  ...monad,
  rpcUrls: {default: {http: GENERAL_RPCS}},
});

/** Reads and writes. Falls through the endpoint list if one is rate-limiting. */
export const publicClient = createPublicClient({
  chain: monadWithRpc,
  transport: fallback(
    GENERAL_RPCS.map((url) => http(url, {batch: true, retryCount: 2})),
    {rank: false},
  ),
});

/**
 * Dedicated client for log queries. Deliberately NOT a fallback transport: falling back to a
 * 100-block-capped endpoint mid-scan would silently return a partial approval list, which is
 * far worse than failing loudly.
 */
export const logsClient = createPublicClient({
  chain: monadWithRpc,
  transport: http(LOGS_RPC, {retryCount: 2, timeout: 30_000}),
});

export const EXPLORER_URL = "https://monadscan.com";

export function txUrl(hash: string) {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function addressUrl(address: string) {
  return `${EXPLORER_URL}/address/${address}`;
}
