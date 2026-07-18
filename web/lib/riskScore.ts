import type {Approval} from "./scanApprovals";

/**
 * Risk scoring is deliberately simple, additive, and fully inspectable. Every point a row
 * receives traces to a named reason that is shown in the UI — there is no opaque model here,
 * and nothing is scored on a signal we did not actually measure on-chain.
 */

export type RiskLevel = "low" | "medium" | "high";

export interface RiskReason {
  label: string;
  points: number;
  detail: string;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  reasons: RiskReason[];
}

/**
 * Anything at or above this is "effectively unlimited". Using 2^200 rather than exactly
 * uint256 max matters: many routers approve max/2, or max minus a spent amount, and those
 * are just as dangerous as a literal max approval but would slip past an equality check.
 */
export const UNLIMITED_THRESHOLD = 2n ** 200n;

const DAY_MS = 86_400_000;

export interface RiskInput {
  approval: Approval;
  /** Approximate age of the most recent approval event, in days. Null when unknown. */
  ageDays: number | null;
  /** True when the spender is a recognised protocol on Monad. */
  knownSpender: boolean;
}

export function assessRisk({approval, ageDays, knownSpender}: RiskInput): RiskAssessment {
  const reasons: RiskReason[] = [];

  if (approval.kind === "ERC721") {
    reasons.push({
      label: "Full collection access",
      points: 40,
      detail:
        "setApprovalForAll lets this spender transfer every NFT in the collection, including ones you buy later.",
    });
  } else if (approval.amount >= UNLIMITED_THRESHOLD) {
    reasons.push({
      label: "Unlimited amount",
      points: 40,
      detail:
        "This spender can move your entire balance of this token, now and forever, without asking again.",
    });
  }

  if (!knownSpender) {
    reasons.push({
      label: "Unrecognised spender",
      points: 20,
      detail:
        "This address is not on our list of known Monad protocols. That does not prove it is malicious, only that we cannot vouch for it.",
    });
  }

  if (ageDays !== null && ageDays >= 180) {
    reasons.push({
      label: "Older than 6 months",
      points: 10,
      detail: `Granted roughly ${Math.round(ageDays)} days ago and never changed since.`,
    });
  } else if (ageDays !== null && ageDays >= 90) {
    reasons.push({
      label: "Older than 3 months",
      points: 5,
      detail: `Granted roughly ${Math.round(ageDays)} days ago and never changed since.`,
    });
  }

  if (!approval.listed) {
    reasons.push({
      label: "Token not on canonical list",
      points: 10,
      detail:
        "This token is not on the official Monad token list. Unknown tokens are sometimes used as bait to get an approval signed.",
    });
  }

  const score = reasons.reduce((sum, r) => sum + r.points, 0);
  return {score, level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", reasons};
}

export function formatAllowance(approval: Approval): string {
  if (approval.kind === "ERC721") return "All items";
  if (approval.amount >= UNLIMITED_THRESHOLD) return "Unlimited";

  const divisor = 10n ** BigInt(approval.decimals);
  const whole = approval.amount / divisor;
  if (whole >= 1_000_000_000n) return `${(Number(whole) / 1e9).toFixed(1)}B`;
  if (whole >= 1_000_000n) return `${(Number(whole) / 1e6).toFixed(1)}M`;
  if (whole >= 1_000n) return `${(Number(whole) / 1e3).toFixed(1)}K`;

  const fraction = approval.amount % divisor;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction.toString().padStart(approval.decimals, "0").slice(0, 4);
  return `${whole}.${fractionStr}`.replace(/\.?0+$/, "");
}

/**
 * Monad block times are sub-second, so a wall-clock age has to be derived from an observed
 * block rate rather than assumed. Callers measure the rate once per scan and pass it in.
 */
export function ageInDays(
  approvalBlock: bigint,
  latestBlock: bigint,
  secondsPerBlock: number,
): number | null {
  if (secondsPerBlock <= 0) return null;
  const blocksAgo = Number(latestBlock - approvalBlock);
  return (blocksAgo * secondsPerBlock * 1000) / DAY_MS;
}
