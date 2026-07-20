"use client";

import {useCallback, useState} from "react";
import {type Address, erc20Abi, parseAbi} from "viem";
import {useAccount, useWalletClient} from "wagmi";
import {publicClient} from "./chain";
import {isRegistryConfigured, KIND, REGISTRY_ADDRESS, revokeAbi, revokeRegistryAbi} from "./contracts";
import type {Approval} from "./scanApprovals";

const nftApprovalAbi = parseAbi([
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
]);

/**
 * A revoke is three on-chain steps, and the UI shows all three rather than collapsing them
 * into one optimistic "done":
 *
 *   1. arm      - registry records the live, nonzero allowance as proof it existed
 *   2. revoke   - approve(spender, 0) sent to the token itself; only the owner can do this
 *   3. confirm  - registry re-reads the allowance and records the revoke only if it is zero
 *
 * Steps 1 and 3 are skipped when no registry is deployed. The revoke in step 2 is the part
 * that actually protects the user and it never depends on our contract.
 */
export type RevokeStep = "idle" | "arming" | "revoking" | "confirming" | "done" | "error";

export interface RevokeState {
  step: RevokeStep;
  /** Hash of the transaction currently awaiting confirmation, if any. */
  pendingHash?: `0x${string}`;
  /** Hash of the approve(spender, 0) transaction, once mined. */
  revokeHash?: `0x${string}`;
  /** Hash of the registry confirm transaction, once mined. */
  logHash?: `0x${string}`;
  error?: string;
  /** True when the allowance was verified to be zero by reading the chain after the fact. */
  verifiedOnChain?: boolean;
}

export function approvalKey(approval: Approval): string {
  return `${approval.kind}:${approval.token.toLowerCase()}:${approval.spender.toLowerCase()}`;
}

/** Wallet rejections are the common case, and should read as a cancellation not a failure. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/user rejected|user denied|rejected the request/i.test(message)) {
    return "Cancelled in wallet";
  }
  if (/insufficient funds/i.test(message)) return "Not enough MON for gas";
  const firstLine = message.split("\n")[0] ?? message;
  return firstLine.length > 140 ? `${firstLine.slice(0, 140)}…` : firstLine;
}

export function useRevoke() {
  const {address} = useAccount();
  const {data: walletClient} = useWalletClient();
  const [states, setStates] = useState<Record<string, RevokeState>>({});

  const update = useCallback((key: string, patch: Partial<RevokeState>) => {
    setStates((prev) => ({...prev, [key]: {...prev[key], ...patch} as RevokeState}));
  }, []);

  const revoke = useCallback(
    async (approval: Approval) => {
      const key = approvalKey(approval);
      if (!walletClient || !address) {
        update(key, {step: "error", error: "Wallet not connected"});
        return;
      }

      const kind = approval.kind === "ERC20" ? KIND.ERC20 : KIND.ERC721;
      const useRegistry = isRegistryConfigured();

      try {
        // ---- 1. arm ----------------------------------------------------------------
        if (useRegistry) {
          update(key, {step: "arming", error: undefined});
          const armHash = await walletClient.writeContract({
            address: REGISTRY_ADDRESS as Address,
            abi: revokeRegistryAbi,
            functionName: "arm",
            args: [kind, approval.token, approval.spender],
          });
          update(key, {pendingHash: armHash});
          const armReceipt = await publicClient.waitForTransactionReceipt({hash: armHash});
          if (armReceipt.status !== "success") throw new Error("Arming transaction reverted");
        }

        // ---- 2. the actual revoke --------------------------------------------------
        update(key, {step: "revoking", pendingHash: undefined});
        const revokeHash =
          approval.kind === "ERC20"
            ? await walletClient.writeContract({
                address: approval.token,
                abi: revokeAbi,
                functionName: "approve",
                args: [approval.spender, 0n],
              })
            : await walletClient.writeContract({
                address: approval.token,
                abi: revokeAbi,
                functionName: "setApprovalForAll",
                args: [approval.spender, false],
              });

        update(key, {pendingHash: revokeHash});
        const revokeReceipt = await publicClient.waitForTransactionReceipt({hash: revokeHash});
        if (revokeReceipt.status !== "success") throw new Error("Revoke transaction reverted");
        update(key, {revokeHash, pendingHash: undefined});

        // Independently verify against chain state rather than trusting a mined receipt.
        // A token could implement approve() as a no-op; this is what catches that.
        const stillApproved =
          approval.kind === "ERC20"
            ? await publicClient.readContract({
                address: approval.token,
                abi: erc20Abi,
                functionName: "allowance",
                args: [address, approval.spender],
              })
            : await publicClient.readContract({
                address: approval.token,
                abi: nftApprovalAbi,
                functionName: "isApprovedForAll",
                args: [address, approval.spender],
              });

        if (stillApproved !== (approval.kind === "ERC20" ? 0n : false)) {
          throw new Error(
            approval.kind === "ERC20"
              ? "Token still reports a nonzero allowance after revoking"
              : "Collection still reports this operator as approved after revoking",
          );
        }
        update(key, {verifiedOnChain: true});

        // ---- 3. confirm ------------------------------------------------------------
        if (useRegistry) {
          update(key, {step: "confirming"});
          const confirmHash = await walletClient.writeContract({
            address: REGISTRY_ADDRESS as Address,
            abi: revokeRegistryAbi,
            functionName: "confirm",
            args: [kind, approval.token, approval.spender],
          });
          update(key, {pendingHash: confirmHash});
          const confirmReceipt = await publicClient.waitForTransactionReceipt({hash: confirmHash});
          if (confirmReceipt.status !== "success") throw new Error("Registry confirmation reverted");
          update(key, {logHash: confirmHash});
        }

        update(key, {step: "done", pendingHash: undefined});
      } catch (error) {
        update(key, {step: "error", error: describeError(error), pendingHash: undefined});
      }
    },
    [address, walletClient, update],
  );

  const reset = useCallback((approval: Approval) => {
    const key = approvalKey(approval);
    setStates((prev) => {
      const next = {...prev};
      delete next[key];
      return next;
    });
  }, []);

  return {states, revoke, reset};
}
