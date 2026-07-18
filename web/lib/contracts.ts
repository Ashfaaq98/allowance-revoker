import type {Address} from "viem";
import {parseAbi} from "viem";

export {revokeRegistryAbi} from "./registryAbi";

/**
 * RevokeRegistry on Monad mainnet. Set via env so the same build can point at a fresh
 * deployment without a code change.
 */
export const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "") as Address | "";

export const isRegistryConfigured = (): boolean =>
  /^0x[a-fA-F0-9]{40}$/.test(REGISTRY_ADDRESS) &&
  REGISTRY_ADDRESS !== "0x0000000000000000000000000000000000000000";

/** Matches the Kind enum in RevokeRegistry.sol. */
export const KIND = {ERC20: 0, ERC721: 1} as const;

export const revokeAbi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]);

/**
 * Known Monad protocol addresses, used to soften the risk score for recognised spenders.
 * Deliberately short and hand-checked. An address missing from this list is reported as
 * "unrecognised", never as "malicious" — absence of evidence is not evidence of danger.
 */
export const KNOWN_SPENDERS: Record<string, string> = {
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Uniswap Permit2",
  "0xca11bde05977b3631167028862be2a173976ca11": "Multicall3",
  "0x3bd359c1119da7da1d913d1c4d2b7c461115433a": "Wrapped MON",
  "0x69f4d1788e39c87893c980c06edf4b7f686e2938": "Safe",
  "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789": "ERC-4337 EntryPoint v0.6",
};

export function spenderLabel(address: Address): string | null {
  return KNOWN_SPENDERS[address.toLowerCase()] ?? null;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
