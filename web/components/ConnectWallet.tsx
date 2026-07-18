"use client";

import {useAccount, useChainId, useConnect, useDisconnect, useSwitchChain} from "wagmi";
import {MONAD_CHAIN_ID} from "@/lib/chain";
import {shortAddress} from "@/lib/contracts";
import {Button} from "./primitives";

export function ConnectWallet() {
  const {address, isConnected} = useAccount();
  const {connect, connectors, isPending} = useConnect();
  const {disconnect} = useDisconnect();
  const chainId = useChainId();
  const {switchChain, isPending: isSwitching} = useSwitchChain();

  const injectedConnector = connectors.find((c) => c.id === "injected") ?? connectors[0];
  const wrongNetwork = isConnected && chainId !== MONAD_CHAIN_ID;

  if (!isConnected) {
    return (
      <Button
        variant="primary"
        onClick={() => injectedConnector && connect({connector: injectedConnector})}
        disabled={isPending || !injectedConnector}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </Button>
    );
  }

  if (wrongNetwork) {
    return (
      <Button variant="danger" onClick={() => switchChain({chainId: MONAD_CHAIN_ID})} disabled={isSwitching}>
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
