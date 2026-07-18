"use client";

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {useState} from "react";
import {createConfig, WagmiProvider} from "wagmi";
import {injected} from "wagmi/connectors";
import {fallback, http} from "viem";
import {monadWithRpc} from "@/lib/chain";

/**
 * Injected connectors only. A WalletConnect project id would add a required secret, a relay
 * dependency and a modal bundle, none of which this app needs — every Monad wallet in practice
 * injects (MetaMask, Rabby, Phantom, Backpack).
 */
export const wagmiConfig = createConfig({
  chains: [monadWithRpc],
  connectors: [injected()],
  transports: {
    [monadWithRpc.id]: fallback(
      monadWithRpc.rpcUrls.default.http.map((url) => http(url, {batch: true})),
      {rank: false},
    ),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export function Providers({children}: {children: React.ReactNode}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Approval state is security-relevant: a stale "revoked" reading is actively
            // misleading, so nothing here is served from cache without a refetch.
            staleTime: 0,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
