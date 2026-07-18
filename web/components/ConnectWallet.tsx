"use client";

import { useSyncExternalStore } from "react";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { MONAD_CHAIN_ID } from "@/lib/chain";
import { shortAddress } from "@/lib/contracts";
import { Button } from "./primitives";

/**
 * Whether a browser wallet has injected itself.
 *
 * Without this the Connect button is a dead click for anyone without an extension: wagmi's
 * injected() connector always exists, so `connect()` is callable but resolves to nothing and
 * the UI sits there looking broken. Detecting the provider lets us say so instead.
 *
 * Some wallets inject after page load and announce it with `ethereum#initialized`, so that is
 * subscribed to rather than sampled once.
 */
function subscribeInjected(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("ethereum#initialized", onChange);
  return () => window.removeEventListener("ethereum#initialized", onChange);
}

function getInjectedSnapshot() {
  return typeof window !== "undefined" && "ethereum" in window;
}

/** Optimistic on the server so the normal button renders, then corrected on the client. */
function getInjectedServerSnapshot() {
  return true;
}

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const hasInjected = useSyncExternalStore(
    subscribeInjected,
    getInjectedSnapshot,
    getInjectedServerSnapshot,
  );

  const injectedConnector =
    connectors.find((c) => c.id === "injected") ?? connectors[0];
  const wrongNetwork = isConnected && chainId !== MONAD_CHAIN_ID;

  if (!isConnected) {
    if (!hasInjected) {
      return (
        <a
          href="https://ethereum.org/en/wallets/find-wallet/"
          target="_blank"
          rel="noopener noreferrer"
          title="No browser wallet detected. A wallet extension such as MetaMask, Rabby, or Phantom is needed to connect."
          className="inline-flex items-center gap-1.5 rounded-md border border-line-bright bg-raised px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-dim transition-colors hover:border-monad/50 hover:text-ink"
        >
          No wallet found
          <svg
            viewBox="0 0 12 12"
            className="size-2.5"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4.5 2h5.5v5.5M10 2L2.5 9.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </a>
      );
    }

    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="primary"
          onClick={() =>
            injectedConnector && connect({ connector: injectedConnector })
          }
          disabled={isPending}
        >
          {isPending ? "Check wallet…" : "Connect wallet"}
        </Button>
        {/* Rejections and unlock prompts are common; silence here reads as a broken button. */}
        {error && (
          <span className="max-w-[15rem] text-right font-mono text-[10px] leading-tight text-risk-high">
            {/user rejected|denied/i.test(error.message)
              ? "Connection cancelled"
              : error.message.split("\n")[0].slice(0, 90)}
          </span>
        )}
      </div>
    );
  }

  if (wrongNetwork) {
    return (
      <Button
        variant="danger"
        onClick={() => switchChain({ chainId: MONAD_CHAIN_ID })}
        disabled={isSwitching}
      >
        {isSwitching ? "Switching…" : "Switch to Monad"}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden items-center gap-1.5 font-mono text-xs text-ink-dim sm:inline-flex">
        <span className="size-1.5 rounded-full bg-ok" />
        {address && shortAddress(address)}
      </span>
      <Button variant="ghost" onClick={() => disconnect()}>
        Disconnect
      </Button>
    </div>
  );
}
