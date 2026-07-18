import {type Address, erc20Abi, getAddress, type Hex, parseAbi} from "viem";
import {logsClient, publicClient} from "./chain";
import {LISTED_BY_ADDRESS} from "./tokenList";

/** keccak256("Approval(address,address,uint256)") */
export const ERC20_APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925" as const;

/** keccak256("ApprovalForAll(address,address,bool)") */
export const ERC721_APPROVAL_FOR_ALL_TOPIC =
  "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31" as const;

export type ApprovalKind = "ERC20" | "ERC721";

export interface Approval {
  kind: ApprovalKind;
  token: Address;
  spender: Address;
  /** Live allowance. For ERC-721 approval-for-all this is 1n. */
  amount: bigint;
  /** Block of the most recent Approval event for this pair. */
  lastUpdatedBlock: bigint;
  symbol: string;
  name: string;
  decimals: number;
  /** True when the token appears on the canonical Monad token list. */
  listed: boolean;
}

export interface ScanResult {
  approvals: Approval[];
  /** False when the log scan could not reach genesis within its request budget. */
  complete: boolean;
  /** Oldest block actually examined. Reported so the UI can state the real coverage. */
  scannedFromBlock: bigint;
  latestBlock: bigint;
  /** Candidate pairs found in logs but dropped because they are no longer live. */
  filteredOut: number;
  secondsPerBlock: number;
}

export interface ScanProgress {
  phase: "logs" | "allowances" | "metadata" | "done";
  message: string;
  fraction: number;
}

const nftAbi = parseAbi([
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
]);

/**
 * Providers signal "range accepted but result set too large" in several shapes. Matching too
 * narrowly leaves an unbounded scan; matching too broadly makes us retry errors that a
 * smaller range cannot fix.
 */
function isRangeOverflowError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("response size exceeded") ||
    message.includes("log response size") ||
    message.includes("query returned more than") ||
    message.includes("block range") ||
    message.includes("limited to a") ||
    message.includes("too large")
  );
}

/** Bounded so a spam-targeted wallet degrades in seconds rather than minutes. */
const MAX_LOG_REQUESTS = 24;
const FALLBACK_CHUNK = 2_000_000n;
const MAX_CHUNK = 32_000_000n;
const WINDOW_CONCURRENCY = 5;

/**
 * On overflow, rpc1 replies with a range it would have accepted, e.g.
 *   "...this block range should work: [0x0, 0x2a364b2]"
 * That span is a live measurement of this wallet's log density, so it calibrates the very
 * first chunk instead of us guessing. Without it the scan wastes most of its budget
 * discovering the right order of magnitude.
 */
function parseSuggestedSpan(error: unknown): bigint | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/should work:\s*\[\s*(0x[0-9a-fA-F]+)\s*,\s*(0x[0-9a-fA-F]+)\s*\]/);
  if (!match) return null;
  const span = BigInt(match[2]) - BigInt(match[1]);
  return span > 0n ? span : null;
}

interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
}

async function rawGetLogs(topics: [Hex, Hex], from: bigint, to: bigint): Promise<RawLog[]> {
  const logs = (await logsClient.request({
    method: "eth_getLogs",
    params: [{fromBlock: `0x${from.toString(16)}` as Hex, toBlock: `0x${to.toString(16)}` as Hex, topics}],
  })) as unknown as Array<{address: Address; topics: Hex[]; data: Hex; blockNumber: Hex}>;

  return logs.map((l) => ({
    address: l.address,
    topics: l.topics,
    data: l.data,
    blockNumber: BigInt(l.blockNumber),
  }));
}

/**
 * Fetch approval logs, newest-first.
 *
 * Fast path is a single full-history query, which is what rpc1 is chosen for and what nearly
 * every real wallet takes. Wallets targeted by approval-spam contracts blow past the provider's
 * 10,000-log response cap, so the fallback walks backwards in adaptive chunks — shrinking on
 * overflow, growing on success — and stops at a request budget.
 *
 * On the fallback path we keep every log gathered so far and report how far back we reached.
 * Silently returning a partial list as if it were complete would be the worst outcome here:
 * the user would believe they have no other approvals when they may well have several.
 */
async function fetchApprovalLogs(
  topics: [Hex, Hex],
  latest: bigint,
  budget: {remaining: number},
  onProgress?: (p: ScanProgress) => void,
): Promise<{logs: RawLog[]; scannedFromBlock: bigint; complete: boolean}> {
  onProgress?.({phase: "logs", message: "Reading approval history", fraction: 0.1});

  let chunk = FALLBACK_CHUNK;

  try {
    budget.remaining -= 1;
    const logs = await rawGetLogs(topics, 0n, latest);
    return {logs, scannedFromBlock: 0n, complete: true};
  } catch (error) {
    if (!isRangeOverflowError(error)) throw error;
    // Calibrate from the provider's own suggestion rather than an arbitrary constant.
    const span = parseSuggestedSpan(error);
    if (span) chunk = span > MAX_CHUNK ? MAX_CHUNK : span;
  }

  // Walk backwards from the head. Coverage is prioritised toward recent blocks deliberately:
  // if the budget runs out, the approvals most likely to still be live are the ones we have,
  // and scannedFromBlock states exactly how far back that guarantee extends.
  //
  // Windows are issued CONCURRENTLY. Each request against a wide range costs ~2.7s of
  // provider time, so a sequential walk spent its entire budget on latency alone; rpc1
  // allows ~15 rps, leaving ample headroom for a small pool.
  const logs: RawLog[] = [];
  let cursor = latest;
  let scannedFromBlock = latest + 1n;
  let complete = false;

  while (cursor > 0n && budget.remaining > 0) {
    const windows: Array<{from: bigint; to: bigint}> = [];
    for (let i = 0; i < WINDOW_CONCURRENCY && cursor > 0n && budget.remaining > 0; i++) {
      const from = cursor > chunk ? cursor - chunk : 0n;
      windows.push({from, to: cursor});
      budget.remaining -= 1;
      cursor = from === 0n ? 0n : from - 1n;
      if (from === 0n) break;
    }
    if (windows.length === 0) break;

    const settled = await Promise.all(
      windows.map((w) =>
        rawGetLogs(topics, w.from, w.to).then(
          (value) => ({ok: true as const, value, w}),
          (error) => {
            if (!isRangeOverflowError(error)) throw error;
            return {ok: false as const, w};
          },
        ),
      ),
    );

    // Keep every log we did retrieve, but only advance the completeness guarantee across the
    // contiguous run of successful windows from the head. A window that overflowed leaves a
    // hole, and claiming coverage past a hole would be the one genuinely misleading outcome.
    for (const s of settled) if (s.ok) logs.push(...s.value);

    let blocked = false;
    for (const s of settled) {
      if (s.ok && !blocked) {
        scannedFromBlock = s.w.from;
        if (s.w.from === 0n) complete = true;
      } else if (!s.ok) {
        blocked = true;
      }
    }

    onProgress?.({
      phase: "logs",
      message: `High-activity wallet — scanned back to block ${scannedFromBlock.toLocaleString()}`,
      fraction: 0.1 + 0.4 * (1 - Number(scannedFromBlock) / Number(latest)),
    });

    if (complete) break;

    if (blocked) {
      if (chunk <= 1n) break;
      chunk = chunk / 4n === 0n ? 1n : chunk / 4n;
      cursor = scannedFromBlock === 0n ? 0n : scannedFromBlock - 1n;
    } else {
      chunk = chunk * 2n > MAX_CHUNK ? MAX_CHUNK : chunk * 2n;
    }
  }

  return {logs, scannedFromBlock: complete ? 0n : scannedFromBlock, complete};
}

function topicToAddress(topic: Hex): Address {
  return getAddress(`0x${topic.slice(26)}`);
}

/** Latest event per (token, spender), which is the only one that reflects current intent. */
function latestPerPair(logs: RawLog[]) {
  const map = new Map<string, {token: Address; spender: Address; block: bigint}>();
  for (const log of logs) {
    // Both ERC-20 Approval and ERC-721 ApprovalForAll index exactly (owner, spender) and put
    // their payload in data => 3 topics. ERC-721's single-token Approval indexes tokenId as a
    // third topic => 4, and shares topic0 with ERC-20. Dropping 4-topic logs is what stops
    // every NFT listing from surfacing as a bogus token row.
    if (log.topics.length !== 3) continue;
    const token = getAddress(log.address);
    const spender = topicToAddress(log.topics[2]);
    const key = `${token.toLowerCase()}|${spender.toLowerCase()}`;
    const existing = map.get(key);
    if (!existing || log.blockNumber > existing.block) map.set(key, {token, spender, block: log.blockNumber});
  }
  return [...map.values()];
}

/**
 * Multicall in slices of our own choosing.
 *
 * `batchSize: 0` disables viem's default 1,024-byte calldata splitting. That default silently
 * turned ~160 allowance reads into dozens of separate eth_calls, which then queued behind
 * rpc1's ~15 rps limit and dominated total scan time. We size the slices ourselves instead so
 * each one is a single aggregate3 call.
 */
async function multicallChunked<T>(contracts: readonly unknown[], size = 150) {
  const out: Array<{status: "success" | "failure"; result?: unknown}> = [];
  for (let i = 0; i < contracts.length; i += size) {
    const slice = contracts.slice(i, i + size);
    const res = await publicClient.multicall({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contracts: slice as any,
      allowFailure: true,
      batchSize: 0,
    });
    out.push(...(res as Array<{status: "success" | "failure"; result?: unknown}>));
  }
  return out as T;
}

/**
 * Discover every approval a wallet currently has outstanding.
 *
 * Approval logs are history, not state. An approval may since have been spent down, reduced,
 * or revoked — and on a public chain most of them are outright spam: contracts that emit
 * Approval events they never backed with a real allowance, purely to appear in wallet UIs.
 * Verified against live Monad mainnet, one sampled wallet had 372 logged "approvals" of which
 * zero were real; every one came from a contract with no working allowance() at all.
 *
 * So logs are used only to find candidate pairs. Every candidate is then re-read on-chain and
 * anything not currently live is dropped.
 */
export async function scanApprovals(
  owner: Address,
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanResult> {
  const paddedOwner = `0x${owner.slice(2).toLowerCase().padStart(64, "0")}` as Hex;

  const latestBlock = await publicClient.getBlockNumber();

  // Sample the block rate to turn block deltas into wall-clock age. The span is clamped to the
  // chain's actual height: a fixed 100k lookback underflows to a negative block number on any
  // chain shorter than that, which is every local node and fresh fork.
  const sampleSpan = latestBlock > 100_000n ? 100_000n : latestBlock;
  const [newBlock, oldBlock] = await Promise.all([
    publicClient.getBlock({blockNumber: latestBlock}),
    publicClient.getBlock({blockNumber: latestBlock - sampleSpan}),
  ]);
  const secondsPerBlock =
    sampleSpan === 0n ? 0 : Number(newBlock.timestamp - oldBlock.timestamp) / Number(sampleSpan);

  // Run both scans concurrently with independent budgets. Sharing one budget sequentially
  // meant a spam-heavy ERC-20 history could starve the NFT scan entirely, and doubled wall
  // time for exactly the wallets that were already slowest.
  const [erc20Scan, nftScan] = await Promise.all([
    fetchApprovalLogs([ERC20_APPROVAL_TOPIC, paddedOwner], latestBlock, {remaining: MAX_LOG_REQUESTS}, onProgress),
    fetchApprovalLogs(
      [ERC721_APPROVAL_FOR_ALL_TOPIC, paddedOwner],
      latestBlock,
      {remaining: MAX_LOG_REQUESTS},
      onProgress,
    ),
  ]);

  const erc20List = latestPerPair(erc20Scan.logs);
  const nftList = latestPerPair(nftScan.logs);
  const candidateCount = erc20List.length + nftList.length;

  onProgress?.({
    phase: "allowances",
    message: `Checking ${candidateCount} candidate approvals against live chain state`,
    fraction: 0.6,
  });

  const allowanceResults = await multicallChunked<Array<{status: string; result?: unknown}>>(
    erc20List.map((c) => ({
      address: c.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, c.spender],
    })),
  );

  const nftResults = await multicallChunked<Array<{status: string; result?: unknown}>>(
    nftList.map((c) => ({
      address: c.token,
      abi: nftAbi,
      functionName: "isApprovedForAll",
      args: [owner, c.spender],
    })),
  );

  // A failed call means the contract has no working allowance() — i.e. it is not a real
  // token. Those are dropped rather than surfaced, since there is nothing to revoke.
  const liveErc20 = erc20List
    .map((c, i) => ({c, r: allowanceResults[i]}))
    .filter(({r}) => r?.status === "success" && (r.result as bigint) > 0n);

  const liveNft = nftList
    .map((c, i) => ({c, r: nftResults[i]}))
    .filter(({r}) => r?.status === "success" && r.result === true);

  onProgress?.({
    phase: "metadata",
    message: `Loading details for ${liveErc20.length + liveNft.length} live approvals`,
    fraction: 0.85,
  });

  const uniqueTokens = [...new Set([...liveErc20, ...liveNft].map(({c}) => c.token))];
  const metaResults = await multicallChunked<Array<{status: string; result?: unknown}>>(
    uniqueTokens.flatMap((token) => [
      {address: token, abi: erc20Abi, functionName: "symbol"},
      {address: token, abi: erc20Abi, functionName: "name"},
      {address: token, abi: erc20Abi, functionName: "decimals"},
    ]),
  );

  const metaByToken = new Map<string, {symbol: string; name: string; decimals: number}>();
  uniqueTokens.forEach((token, i) => {
    const listed = LISTED_BY_ADDRESS.get(token.toLowerCase());
    const [symbol, name, decimals] = [metaResults[i * 3], metaResults[i * 3 + 1], metaResults[i * 3 + 2]];
    metaByToken.set(token.toLowerCase(), {
      // Canonical list first, then whatever the contract reports, then an explicit unknown.
      // Never invent a friendly name for a contract we cannot identify.
      symbol: listed?.s ?? (symbol?.status === "success" ? (symbol.result as string) : "???"),
      name:
        listed?.n ??
        (name?.status === "success" ? (name.result as string) : `Unidentified ${token.slice(0, 10)}`),
      decimals: listed?.d ?? (decimals?.status === "success" ? Number(decimals.result) : 18),
    });
  });

  const approvals: Approval[] = [
    ...liveErc20.map(({c, r}) => ({
      kind: "ERC20" as const,
      token: c.token,
      spender: c.spender,
      amount: r.result as bigint,
      lastUpdatedBlock: c.block,
      listed: LISTED_BY_ADDRESS.has(c.token.toLowerCase()),
      ...metaByToken.get(c.token.toLowerCase())!,
    })),
    ...liveNft.map(({c}) => ({
      kind: "ERC721" as const,
      token: c.token,
      spender: c.spender,
      amount: 1n,
      lastUpdatedBlock: c.block,
      listed: LISTED_BY_ADDRESS.has(c.token.toLowerCase()),
      ...metaByToken.get(c.token.toLowerCase())!,
    })),
  ];

  onProgress?.({phase: "done", message: `Found ${approvals.length} active approvals`, fraction: 1});

  return {
    approvals,
    complete: erc20Scan.complete && nftScan.complete,
    scannedFromBlock:
      erc20Scan.scannedFromBlock > nftScan.scannedFromBlock
        ? erc20Scan.scannedFromBlock
        : nftScan.scannedFromBlock,
    latestBlock,
    filteredOut: candidateCount - approvals.length,
    secondsPerBlock,
  };
}
