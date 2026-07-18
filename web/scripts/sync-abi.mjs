// Regenerates lib/registryAbi.ts from the Foundry build artifact so the frontend ABI can
// never drift from the deployed contract. Run: npm run sync-abi (after `forge build`).
import {readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const artifact = resolve(here, "../../contracts/out/RevokeRegistry.sol/RevokeRegistry.json");
const {abi} = JSON.parse(readFileSync(artifact, "utf8"));

const out = `// GENERATED FILE - do not edit by hand.
// Source: contracts/src/RevokeRegistry.sol
// Regenerate with: npm run sync-abi

export const revokeRegistryAbi = ${JSON.stringify(abi, null, 2)} as const;
`;

writeFileSync(resolve(here, "../lib/registryAbi.ts"), out);
console.log(`Wrote lib/registryAbi.ts (${abi.length} entries)`);
