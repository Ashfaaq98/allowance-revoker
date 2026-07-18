"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {type Address, isAddress} from "viem";
import {useAccount, useChainId, useReadContract} from "wagmi";
import {ApprovalTable, type ScoredApproval} from "@/components/ApprovalTable";
import {ConnectWallet} from "@/components/ConnectWallet";
import {Button, Panel, Spinner, Stat} from "@/components/primitives";
import {MONAD_CHAIN_ID} from "@/lib/chain";
import {
  isRegistryConfigured,
  REGISTRY_ADDRESS,
  revokeRegistryAbi,
  shortAddress,
  spenderLabel,
} from "@/lib/contracts";
import {ageInDays, assessRisk} from "@/lib/riskScore";
import {type Approval, scanApprovals, type ScanProgress, type ScanResult} from "@/lib/scanApprovals";
import {useRevoke} from "@/lib/useRevoke";

type Filter = "all" | "high" | "medium" | "low";

export default function Home() {
  const {address: connectedAddress, isConnected} = useAccount();
  const chainId = useChainId();
  const {states, revoke} = useRevoke();

  /** Set when inspecting someone else's wallet read-only. Null means "use my own". */
  const [watchAddress, setWatchAddress] = useState<Address | null>(null);

  // ?address=0x… deep link, so an approval report can be shared or bookmarked.
  // Read from location rather than useSearchParams to keep this page statically rendered.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("address");
    if (param && isAddress(param)) setWatchAddress(param);
  }, []);

  const [result, setResult] = useState<ScanResult | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
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

  const {data: cleanupScore, refetch: refetchScore} = useReadContract({
    address: registryEnabled ? (REGISTRY_ADDRESS as Address) : undefined,
    abi: revokeRegistryAbi,
    functionName: "cleanupScore",
    args: target ? [target] : undefined,
    query: {enabled: registryEnabled && !!target},
  });

  const runScan = useCallback(async () => {
    if (!target) return;
    setScanError(null);
    setResult(null);
    setProgress({phase: "logs", message: "Starting scan", fraction: 0.02});
    try {
      setResult(await scanApprovals(target, setProgress));
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
    } finally {
      setProgress(null);
    }
  }, [target]);

  // Scan as soon as there is a wallet to look at — seeing what is exposed is the whole point.
  useEffect(() => {
    if (target) void runScan();
  }, [target, runScan]);

  const scored = useMemo<ScoredApproval[]>(() => {
    if (!result) return [];
    return result.approvals
      .map((approval) => {
        const days = ageInDays(approval.lastUpdatedBlock, result.latestBlock, result.secondsPerBlock);
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

  const counts = useMemo(() => {
    const c = {high: 0, medium: 0, low: 0};
    for (const s of scored) c[s.risk.level]++;
    return c;
  }, [scored]);

  const visible = useMemo(
    () => (filter === "all" ? scored : scored.filter((s) => s.risk.level === filter)),
    [scored, filter],
  );

  const handleRevoke = useCallback(
    async (approval: Approval) => {
      await revoke(approval);
      void refetchScore();
    },
    [revoke, refetchScore],
  );

  const scanning = progress !== null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded border border-monad/40 bg-monad/10">
            <svg viewBox="0 0 20 20" className="size-4 text-monad-bright" fill="none" aria-hidden="true">
              <path
                d="M10 2l6.5 3v5c0 3.5-2.6 6.6-6.5 8-3.9-1.4-6.5-4.5-6.5-8V5L10 2z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-medium leading-tight tracking-tight">Allowance Revoker</h1>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              Monad Mainnet · Chain 143
            </span>
          </div>
        </div>
        <ConnectWallet />
      </header>

      {!target ? (
        <Landing onInspect={setWatchAddress} />
      ) : isConnected && chainId !== MONAD_CHAIN_ID && !watchAddress ? (
        <CenteredNotice
          title="Wrong network"
          body="This dashboard reads approvals from Monad mainnet. Switch networks to continue."
        />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          {!canRevoke && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded border border-monad/25 bg-monad/5 px-3 py-2">
              <span className="font-mono text-[11px] text-monad-bright">
                Read-only — viewing {shortAddress(target)}. Live chain data, but only this wallet&apos;s
                owner can revoke its approvals.
              </span>
              <div className="flex gap-2">
                {watchAddress && (
                  <Button variant="ghost" onClick={() => setWatchAddress(null)}>
                    Exit
                  </Button>
                )}
                {!isConnected && <ConnectWallet />}
              </div>
            </div>
          )}

          <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 rounded-lg border border-line bg-surface/80 px-5 py-3.5">
            <div className="flex flex-wrap items-end gap-7">
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
              <Stat label="Bounded" value={scanning ? "—" : counts.low} hint="Approvals scoring under 30" />
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
              <CenteredNotice title="No scan yet" body="Run a scan to read approvals from the chain." />
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

function CoverageNote({result}: {result: ScanResult}) {
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
      title="This wallet has more approval history than can be read in one pass. Everything after this block was checked."
    >
      partial · scanned back to block {result.scannedFromBlock.toLocaleString()}
    </span>
  );
}

function ScanningState({progress}: {progress: ScanProgress | null}) {
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

function CenteredNotice({title, body, action}: {title: string; body: string; action?: React.ReactNode}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h3 className="font-mono text-sm text-ink">{title}</h3>
      <p className="max-w-md text-xs leading-relaxed text-ink-dim">{body}</p>
      {action}
    </div>
  );
}

const STEPS = [
  {n: "01", t: "Scan", d: "Read every Approval event your wallet has emitted, back to genesis."},
  {n: "02", t: "Verify", d: "Re-check each one against live state. Spam and spent approvals drop out."},
  {n: "03", t: "Revoke", d: "Set the allowance to zero, and prove the cleanup on-chain."},
];

function Landing({onInspect}: {onInspect: (address: Address) => void}) {
  const [input, setInput] = useState("");
  const trimmed = input.trim();
  const valid = isAddress(trimmed);

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
              <li key={s.n} className="flex gap-3 rounded border border-line bg-surface/60 px-3 py-2.5">
                <span className="font-mono text-[10px] text-monad">{s.n}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-xs uppercase tracking-wider text-ink">{s.t}</span>
                  <span className="text-[11px] leading-relaxed text-ink-dim">{s.d}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <label
              htmlFor="inspect"
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint"
            >
              Or inspect any address, read-only
            </label>
            <div className="flex gap-2">
              <input
                id="inspect"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) onInspect(trimmed as Address);
                }}
                placeholder="0x…"
                spellCheck={false}
                className="min-w-0 flex-1 rounded border border-line bg-void px-2.5 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-ink-faint focus:border-monad/60"
              />
              <Button
                variant="default"
                disabled={!valid}
                onClick={() => valid && onInspect(trimmed as Address)}
              >
                Scan
              </Button>
            </div>
            {trimmed.length > 0 && !valid && (
              <span className="font-mono text-[10px] text-risk-high">Not a valid address</span>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
