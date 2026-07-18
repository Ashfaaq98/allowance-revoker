#!/usr/bin/env bash
#
# Spin up a local chain that the dashboard treats as Monad mainnet, deploy the registry and a
# mock token, and grant an unlimited approval — so the full arm -> revoke -> confirm flow can
# be exercised in a browser without spending real funds or owning a wallet.
#
# Usage:  ./scripts/local-e2e.sh
# Then:   cd web && npm run dev     (reads the .env.local this writes)
#
# The private key below is anvil's first well-known development account. It is published in
# Foundry's own documentation, holds nothing on any real network, and must never be funded.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC="http://localhost:8545"
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
SPENDER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
MULTICALL3=0xcA11bde05977b3631167028862bE2a173976CA11
MAX=0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff

command -v anvil >/dev/null || { echo "anvil not found — install Foundry: https://getfoundry.sh"; exit 1; }

echo "==> starting anvil as chain 143, so the app sees a chain it recognises as Monad"
pkill -f "anvil --port 8545" 2>/dev/null || true
sleep 1
anvil --port 8545 --chain-id 143 --silent >/dev/null 2>&1 &
sleep 4

# The dashboard reads every balance and allowance through Multicall3. Monad has it at the
# canonical address; a bare anvil does not, and without it every approval is silently
# discarded as dead. Copy the real runtime bytecode across.
echo "==> installing Multicall3 (copied from Monad mainnet)"
CODE=$(cast code "$MULTICALL3" --rpc-url https://rpc.monad.xyz)
cast rpc anvil_setCode "$MULTICALL3" "$CODE" --rpc-url "$RPC" >/dev/null

echo "==> deploying RevokeRegistry and a mock token"
cd "$REPO/contracts"
REGISTRY=$(forge create src/RevokeRegistry.sol:RevokeRegistry \
  --rpc-url "$RPC" --private-key "$KEY" --broadcast 2>/dev/null |
  grep "Deployed to:" | awk '{print $3}')
TOKEN=$(forge create test/RevokeRegistry.t.sol:MockERC20 \
  --rpc-url "$RPC" --private-key "$KEY" --broadcast 2>/dev/null |
  grep "Deployed to:" | awk '{print $3}')

echo "==> granting an unlimited approval, exactly as a dApp would"
cast send "$TOKEN" "approve(address,uint256)" "$SPENDER" "$MAX" \
  --rpc-url "$RPC" --private-key "$KEY" >/dev/null

printf 'NEXT_PUBLIC_RPC_URL=%s\nNEXT_PUBLIC_REGISTRY_ADDRESS=%s\n' "$RPC" "$REGISTRY" \
  >"$REPO/web/.env.local"

cat <<EOF

Ready.

  registry   $REGISTRY
  token      $TOKEN
  owner      $OWNER
  spender    $SPENDER
  allowance  unlimited

Wrote web/.env.local. Now run:

  cd web && npm run dev

Import the anvil account above into a browser wallet (RPC $RPC, chain 143),
connect, and the dashboard will show one HIGH-risk unlimited approval to revoke.

Verify afterwards with:

  cast call $TOKEN 'allowance(address,address)(uint256)' $OWNER $SPENDER --rpc-url $RPC
  cast call $REGISTRY 'cleanupScore(address)(uint256)' $OWNER --rpc-url $RPC

Stop the chain with: pkill -f 'anvil --port 8545'
EOF
