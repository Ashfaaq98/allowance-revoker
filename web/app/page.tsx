"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { type Address, isAddress } from "viem";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { AddressInput } from "@/components/AddressInput";
import { ApprovalTable, type ScoredApproval } from "@/components/ApprovalTable";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Button, ExposureBar, Panel, Spinner, Stat } from "@/components/primitives";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MONAD_CHAIN_ID } from "@/lib/chain";
import {
  isRegistryConfigured,
  REGISTRY_ADDRESS,
  revokeRegistryAbi,
  shortAddress,
  spenderLabel,
} from "@/lib/contracts";
import { ageInDays, assessRisk } from "@/lib/riskScore";
import {
  type Approval,
  scanApprovals,
  type ScanProgress,
  type ScanResult,
} from "@/lib/scanApprovals";
import { approvalKey, useRevoke } from "@/lib/useRevoke";

type Filter = "all" | "high" | "medium" | "low";

export default function Home() {
  // useSearchParams needs a Suspense boundary on a statically prerendered route.
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const { address: connectedAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const { states, revoke } = useRevoke();

  /**
   * The inspected address lives entirely in the URL (?address=0x…). Keeping a second copy in
   * component state was the bug behind a dead "Exit" button: clearing the state simply fell
   * back to the still-present query param. A single source of truth also makes every view
   * shareable and bookmarkable for free.
   */
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkedAddress = searchParams.get("address");
  const watchAddress =
    linkedAddress && isAddress(linkedAddress) ? (linkedAddress as Address) : null;

  const inspectAddress = useCallback((next: Address) => router.push(`/?address=${next}`), [router]);
  const clearInspection = useCallback(() => router.push("/"), [router]);

  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const registryEnabled = isRegistryConfigured();
  const target = watchAddress ?? connectedAddress ?? null;
  // Revoking requires the connected wallet to BE the wallet on screen — only an owner can
  // change their own allowance, so offering the button otherwise would be a dead end.
  const canRevoke =
    isConnected &&
    chainId === MONAD_CHAIN_ID &&
    !!connectedAddress &&
    !!target &&
    connectedAddress.toLowerCase() === target.toLowerCase();

  const { data: cleanupScore, refetch: refetchScore } = useReadContract({
    address: registryEnabled ? (REGISTRY_ADDRESS as Address) : undefined,
    abi: revokeRegistryAbi,
    functionName: "cleanupScore",
    args: target ? [target] : undefined,
    query: { enabled: registryEnabled && !!target },
  });

  // Scanning is modelled as a query keyed on the address, so it starts automatically whenever
  // there is a wallet to look at — seeing what is already exposed is the entire point.
  const {
    data: result = null,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["approvals", target],
    queryFn: async () => {
      setProgress({ phase: "logs", message: "Starting scan", fraction: 0.02 });
      return scanApprovals(target as Address, setProgress);
    },
    enabled: !!target,
    retry: false,
    // Results carry bigints, which structural sharing cannot diff.
    structuralSharing: false,
  });

  const runScan = useCallback(() => void refetch(), [refetch]);
  const scanError = error ? (error instanceof Error ? error.message : String(error)) : null;

  const scored = useMemo<ScoredApproval[]>(() => {
    if (!result) return [];
    return result.approvals
      .map((approval) => {
        const days = ageInDays(
          approval.lastUpdatedBlock,
          result.latestBlock,
          result.secondsPerBlock,
        );
        return {
          approval,
          ageDays: days,
          risk: assessRisk({
            approval,
            ageDays: days,
            knownSpender: spenderLabel(approval.spender) !== null,
          }),
        };
      })
      .sort((a, b) => b.risk.score - a.risk.score);
  }, [result]);

  // Already-revoked rows are excluded from the counts. They stay visible so their transaction
  // links remain reachable, but leaving them in the totals meant the headline still read
  // "1 at risk" moments after the chain confirmed that approval was gone.
  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 };
    for (const s of scored) {
      if (states[approvalKey(s.approval)]?.step === "done") continue;
      c[s.risk.level]++;
    }
    return c;
  }, [scored, states]);

  const visible = useMemo(
    () => (filter === "all" ? scored : scored.filter((s) => s.risk.level === filter)),
    [scored, filter],
  );

  const handleRevoke = useCallback(
    async (approval: Approval) => {
      const proofNote = registryEnabled
        ? " This will request three transactions: arm proof, revoke, then confirm proof."
        : " This will request one revoke transaction.";
      if (!window.confirm(`Revoke this ${approval.kind} approval?${proofNote}`)) return;
      await revoke(approval);
      void refetchScore();
    },
    [registryEnabled, revoke, refetchScore],
  );

  const scanning = isFetching;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded border border-monad/40 bg-monad/10">
            <svg
              viewBox="0 0 20 20"
              className="size-4 text-monad-bright"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M10 2l6.5 3v5c0 3.5-2.6 6.6-6.5 8-3.9-1.4-6.5-4.5-6.5-8V5L10 2z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M7 10l2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-medium leading-tight tracking-tight">Allowance Revoker</h1>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              Monad Mainnet · Chain 143
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {/* The landing hero carries its own prominent Connect CTA, so the header suppresses
              its copy there rather than showing the same button twice. */}
          {target && <ConnectWallet />}
        </div>
      </header>

      {!target ? (
        <Landing onInspect={inspectAddress} />
      ) : isConnected && chainId !== MONAD_CHAIN_ID && !watchAddress ? (
        <CenteredNotice
          title="Wrong network"
          body="This dashboard reads approvals from Monad mainnet. Switch networks to continue."
        />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          {!canRevoke && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-monad/25 bg-monad/5 px-3 py-2">
              <span className="font-mono text-[11px] text-monad-bright">
                Read-only — viewing {shortAddress(target)}.{" "}
                {isConnected
                  ? "Only this wallet's owner can revoke its approvals."
                  : "Connect this wallet to revoke."}
              </span>
              {/* Address switcher lives here so you are not stranded on whichever wallet you
                  first opened. The header already carries the only Connect button. */}
              <div className="flex items-center gap-2">
                <AddressInput
                  onSubmit={inspectAddress}
                  size="sm"
                  placeholder="Inspect another address…"
                />
                {watchAddress && (
                  <Button variant="ghost" size="sm" onClick={clearInspection}>
                    Exit
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex shrink-0 flex-col gap-3 rounded-xl border border-line bg-surface px-5 py-4 shadow-panel">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-8">
                <Stat
                  label="At risk"
                  value={scanning ? "—" : counts.high}
                  tone={counts.high > 0 ? "danger" : "good"}
                  hint="Approvals scoring 60 or above"
                />
                <Stat
                  label="Worth review"
                  value={scanning ? "—" : counts.medium}
                  tone={counts.medium > 0 ? "warn" : "default"}
                  hint="Approvals scoring 30 to 59"
                />
                <Stat
                  label="Bounded"
                  value={scanning ? "—" : counts.low}
                  hint="Approvals scoring under 30"
                />
                {registryEnabled && (
                  <Stat
                    label="Cleanup score"
                    value={cleanupScore === undefined ? "—" : String(cleanupScore)}
                    tone="monad"
                    hint="Approvals provably revoked, recorded on-chain"
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                {(["all", "high", "medium", "low"] as const).map((f) => (
                  <Button
                    key={f}
                    variant={filter === f ? "primary" : "ghost"}
                    onClick={() => setFilter(f)}
                    disabled={scanning}
                  >
                    {f}
                  </Button>
                ))}
                <Button onClick={runScan} disabled={scanning}>
                  {scanning ? "Scanning…" : "Rescan"}
                </Button>
              </div>
            </div>
            {!scanning && <ExposureBar counts={counts} />}
          </div>

          <Panel
            title={
              result
                ? `${visible.length} approval${visible.length === 1 ? "" : "s"}${
                    filter === "all" ? "" : ` · ${filter} risk`
                  }`
                : "Approvals"
            }
            action={result ? <CoverageNote result={result} /> : undefined}
            className="flex-1"
          >
            {scanning ? (
              <ScanningState progress={progress} />
            ) : scanError ? (
              <CenteredNotice
                title="Scan failed"
                body={scanError}
                action={<Button onClick={runScan}>Try again</Button>}
              />
            ) : !result ? (
              <CenteredNotice
                title="No scan yet"
                body="Run a scan to read approvals from the chain."
              />
            ) : visible.length === 0 ? (
              <CenteredNotice
                title={scored.length === 0 ? "Nothing exposed" : `No ${filter}-risk approvals`}
                body={
                  scored.length === 0
                    ? `This wallet has no active token approvals. ${result.filteredOut} historical approval event${
                        result.filteredOut === 1 ? " was" : "s were"
                      } checked and found already revoked, spent, or spam.`
                    : "Try a different filter."
                }
              />
            ) : (
              <ApprovalTable
                items={visible}
                states={states}
                onRevoke={handleRevoke}
                registryEnabled={registryEnabled}
                canRevoke={canRevoke}
              />
            )}
          </Panel>

          {!registryEnabled && (
            <p className="shrink-0 rounded border border-risk-med/25 bg-risk-med-deep/50 px-3 py-2 font-mono text-[11px] text-risk-med">
              Registry contract not configured. Revoking works normally; on-chain cleanup proofs are
              disabled until NEXT_PUBLIC_REGISTRY_ADDRESS is set.
            </p>
          )}
        </main>
      )}
    </div>
  );
}

function CoverageNote({ result }: { result: ScanResult }) {
  if (result.complete) {
    return (
      <span className="font-mono text-[10px] text-ink-faint">
        full history · {result.filteredOut} dead/spam filtered
      </span>
    );
  }
  return (
    <span
      className="font-mono text-[10px] text-risk-med"
      title="This wallet has more approval history than can be read in one pass. Rescan to retry the most recent coverage; do not treat this as a complete history."
    >
      partial history · through block {result.scannedFromBlock.toLocaleString()} · rescan to retry
    </span>
  );
}

function ScanningState({ progress }: { progress: ScanProgress | null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="scan-beam relative h-0.5 w-56 overflow-hidden rounded-full bg-line" />
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="inline-flex items-center gap-2 font-mono text-xs text-ink-dim">
          <Spinner className="text-monad" />
          {progress?.message ?? "Scanning"}
        </span>
        <span className="font-mono text-[10px] text-ink-faint">
          reading Approval events directly from Monad
        </span>
      </div>
    </div>
  );
}

function CenteredNotice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h3 className="font-mono text-sm text-ink">{title}</h3>
      <p className="max-w-md text-xs leading-relaxed text-ink-dim">{body}</p>
      {action}
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    t: "Scan",
    d: "Read ERC-20 Approval and ERC-721 collection-approval events back to genesis.",
  },
  {
    n: "02",
    t: "Verify",
    d: "Re-check each one against live state. Spam and spent approvals drop out.",
  },
  {
    n: "03",
    t: "Revoke",
    d: "Set the allowance to zero, and prove the cleanup on-chain.",
  },
];

function Landing({ onInspect }: { onInspect: (address: Address) => void }) {
  return (
    <main className="flex flex-1 items-center justify-center overflow-auto p-6">
      <div className="grid w-full max-w-4xl gap-10 md:grid-cols-[1.15fr_1fr] md:items-center">
        <div className="flex flex-col items-start gap-5">
          <span className="rounded border border-line-bright px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            Wallet hygiene · Monad
          </span>
          <h2 className="text-[1.75rem] leading-[1.2] tracking-tight">
            Every dApp you have used still has permission to move your tokens.
          </h2>
          <p className="text-sm leading-relaxed text-ink-dim">
            Approvals do not expire. Months later you have forgotten which contracts you granted
            access to, and most of them asked for an unlimited amount. If any one of them is
            exploited, the attacker does not need your keys — they use the approval you already
            signed.
          </p>
          <div className="flex flex-col items-start gap-2">
            <ConnectWallet />
            <span className="font-mono text-[10px] text-ink-faint">
              Read-only until you choose to revoke. No backend, no tracking.
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <ol className="flex flex-col gap-3">
            {STEPS.map((s) => (
              <li
                key={s.n}
                className="flex gap-3 rounded border border-line bg-surface/60 px-3 py-2.5"
              >
                <span className="font-mono text-[10px] text-monad">{s.n}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-xs uppercase tracking-wider text-ink">{s.t}</span>
                  <span className="text-[11px] leading-relaxed text-ink-dim">{s.d}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              Or inspect any address, read-only
            </span>
            <AddressInput onSubmit={onInspect} />
            <span className="font-mono text-[10px] text-ink-faint">
              No wallet needed — blockchain data is public.
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
