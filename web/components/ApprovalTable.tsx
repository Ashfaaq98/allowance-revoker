"use client";

import { useState } from "react";
import { addressUrl, txUrl } from "@/lib/chain";
import { shortAddress, spenderLabel } from "@/lib/contracts";
import {
  formatAllowance,
  type RiskAssessment,
  type RiskLevel,
} from "@/lib/riskScore";
import type { Approval } from "@/lib/scanApprovals";
import { approvalKey, type RevokeState } from "@/lib/useRevoke";
import { Button, RiskBadge, Spinner } from "./primitives";

export interface ScoredApproval {
  approval: Approval;
  risk: RiskAssessment;
  ageDays: number | null;
}

const STEP_LABEL: Record<string, string> = {
  arming: "Arming proof…",
  revoking: "Revoking…",
  confirming: "Logging on-chain…",
};

/** A coloured left edge so severity is legible while scrolling, without reading the badge. */
const EDGE: Record<RiskLevel, string> = {
  high: "before:bg-risk-high",
  medium: "before:bg-risk-med",
  low: "before:bg-transparent",
};

function RevokeCell({
  item,
  state,
  onRevoke,
  registryEnabled,
  canRevoke,
}: {
  item: ScoredApproval;
  state?: RevokeState;
  onRevoke: () => void;
  registryEnabled: boolean;
  canRevoke: boolean;
}) {
  const step = state?.step ?? "idle";

  if (step === "done") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ok">
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 8.5l3.5 3.5L13 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Revoked
        </span>
        <div className="flex gap-2 font-mono text-[10px]">
          {state?.revokeHash && (
            <a
              href={txUrl(state.revokeHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-faint underline decoration-dotted hover:text-monad-bright"
            >
              revoke tx
            </a>
          )}
          {state?.logHash && (
            <a
              href={txUrl(state.logHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-faint underline decoration-dotted hover:text-monad-bright"
            >
              proof tx
            </a>
          )}
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="max-w-[15rem] text-right font-mono text-[11px] leading-tight text-risk-high">
          {state?.error}
        </span>
        <Button variant="ghost" size="sm" onClick={onRevoke}>
          Retry
        </Button>
      </div>
    );
  }

  if (step !== "idle") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="inline-flex items-center gap-2 font-mono text-xs text-monad-bright">
          <Spinner />
          {STEP_LABEL[step] ?? "Working…"}
        </span>
        {state?.pendingHash && (
          <a
            href={txUrl(state.pendingHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] text-ink-faint underline decoration-dotted hover:text-monad-bright"
          >
            {shortAddress(state.pendingHash)}
          </a>
        )}
      </div>
    );
  }

  return (
    <Button
      variant={item.risk.level === "high" ? "danger" : "default"}
      onClick={onRevoke}
      disabled={!canRevoke}
      title={
        !canRevoke
          ? "Connect this wallet to revoke. Only an owner can change their own allowance."
          : registryEnabled
            ? "Arms an on-chain proof, revokes the approval, then records it"
            : "Revokes the approval. On-chain logging is disabled until the registry is deployed."
      }
    >
      Revoke
    </Button>
  );
}

function Row({
  item,
  state,
  onRevoke,
  registryEnabled,
  canRevoke,
}: {
  item: ScoredApproval;
  state?: RevokeState;
  onRevoke: () => void;
  registryEnabled: boolean;
  canRevoke: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { approval, risk, ageDays } = item;
  const label = spenderLabel(approval.spender);
  const unlimited =
    approval.kind === "ERC721" || formatAllowance(approval) === "Unlimited";
  const done = state?.step === "done";

  return (
    <>
      <tr
        className={`group border-b border-line/70 transition-colors hover:bg-raised/70 ${done ? "opacity-40" : ""}`}
      >
        <td
          className={`relative py-3 pl-4 pr-2 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] ${EDGE[risk.level]}`}
        >
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-2 text-left"
            aria-expanded={open}
          >
            <svg
              viewBox="0 0 16 16"
              className={`size-3 shrink-0 text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M6 3l5 5-5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-mono text-[13px] font-medium text-ink">
                  {approval.symbol}
                </span>
                {approval.kind === "ERC721" && (
                  <span className="rounded border border-line-bright px-1 font-mono text-[9px] uppercase text-ink-faint">
                    NFT
                  </span>
                )}
              </span>
              <span className="truncate text-[11px] text-ink-faint">
                {approval.name}
              </span>
            </span>
          </button>
        </td>

        <td className="px-2 py-3">
          <a
            href={addressUrl(approval.spender)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-ink-dim underline decoration-dotted underline-offset-2 hover:text-monad-bright"
            title={approval.spender}
          >
            {label ?? shortAddress(approval.spender)}
          </a>
        </td>

        <td className="px-2 py-3">
          <span
            className={`font-mono text-xs tabular-nums ${
              unlimited ? "font-medium text-risk-high" : "text-ink-dim"
            }`}
          >
            {formatAllowance(approval)}
          </span>
        </td>

        <td className="px-2 py-3">
          <span className="font-mono text-xs tabular-nums text-ink-faint">
            {ageDays === null
              ? "—"
              : ageDays < 1
                ? "today"
                : `${Math.round(ageDays)}d`}
          </span>
        </td>

        <td className="px-2 py-3">
          <RiskBadge level={risk.level} score={risk.score} />
        </td>

        <td className="py-3 pl-2 pr-4 text-right">
          <RevokeCell
            item={item}
            state={state}
            onRevoke={onRevoke}
            registryEnabled={registryEnabled}
            canRevoke={canRevoke}
          />
        </td>
      </tr>

      {open && (
        <tr className="row-in border-b border-line/70 bg-raised/40">
          <td colSpan={6} className="px-4 py-3 pl-9">
            <div className="flex flex-col gap-2.5">
              <ul className="flex flex-col gap-1.5">
                {risk.reasons.length === 0 && (
                  <li className="text-[11px] text-ink-faint">
                    No risk signals matched — a bounded approval to a recognised
                    spender.
                  </li>
                )}
                {risk.reasons.map((reason) => (
                  <li
                    key={reason.label}
                    className="flex gap-2.5 text-[11px] leading-relaxed"
                  >
                    <span className="mt-px shrink-0 rounded bg-raised px-1 font-mono text-[10px] text-risk-med">
                      +{reason.points}
                    </span>
                    <span className="text-ink-dim">
                      <span className="font-medium text-ink">
                        {reason.label}.
                      </span>{" "}
                      {reason.detail}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-2 font-mono text-[10px] text-ink-faint">
                <span>
                  token{" "}
                  <a
                    href={addressUrl(approval.token)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-dim underline decoration-dotted hover:text-monad-bright"
                  >
                    {approval.token}
                  </a>
                </span>
                <span>
                  spender{" "}
                  <a
                    href={addressUrl(approval.spender)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-dim underline decoration-dotted hover:text-monad-bright"
                  >
                    {approval.spender}
                  </a>
                </span>
                <span>
                  changed at block {approval.lastUpdatedBlock.toLocaleString()}
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function ApprovalTable({
  items,
  states,
  onRevoke,
  registryEnabled,
  canRevoke,
}: {
  items: ScoredApproval[];
  states: Record<string, RevokeState>;
  onRevoke: (approval: Approval) => void;
  registryEnabled: boolean;
  canRevoke: boolean;
}) {
  const headers = ["Token", "Spender", "Allowance", "Age", "Risk", ""];
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[26%]" />
          <col className="w-[18%]" />
          <col className="w-[15%]" />
          <col className="w-[8%]" />
          <col className="w-[15%]" />
          <col className="w-[18%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-line">
            {headers.map((h, i) => (
              <th
                key={h || i}
                className={`bg-surface py-2.5 font-mono text-[10px] font-normal uppercase tracking-[0.16em] text-ink-faint ${
                  i === 0
                    ? "pl-4 pr-2 text-left"
                    : i === 5
                      ? "pl-2 pr-4 text-right"
                      : "px-2 text-left"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <Row
              key={approvalKey(item.approval)}
              item={item}
              state={states[approvalKey(item.approval)]}
              onRevoke={() => onRevoke(item.approval)}
              registryEnabled={registryEnabled}
              canRevoke={canRevoke}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
