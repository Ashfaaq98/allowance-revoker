// Live integration check against Monad mainnet. Deliberately hits the real chain, because the
// failure modes that matter here (provider log caps, spam contracts) only exist there.
import {scanApprovals} from "../lib/scanApprovals";
import {assessRisk, ageInDays, formatAllowance} from "../lib/riskScore";
import {spenderLabel, shortAddress} from "../lib/contracts";
import type {Address} from "viem";

const WALLETS: Address[] = [
  "0x821d7c06a0D0cA9B2dCF4304d99c4bBE29ACE610",
  "0xeebc9F9D77b8982CDC48C995995eBB7dd74A3Dcf",
  "0x09AD820aaC5779683B481c4674208A4e1B024Afa",
  "0x2ee25bBbd6795F058876eb206c98F8A55B149D14",
  "0xd7Ae751eC282f90aF794738f80909d0E94b4908B", // previously took 469s
];

for (const wallet of WALLETS) {
  const started = Date.now();
  try {
    const res = await scanApprovals(wallet);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\n${wallet}  [${elapsed}s]`);
    console.log(
      `  ${res.approvals.length} live | ${res.filteredOut} filtered (dead/spam) | ` +
        `coverage ${res.complete ? "FULL history" : `from block ${res.scannedFromBlock.toLocaleString()}`} | ` +
        `${res.secondsPerBlock.toFixed(3)}s/block`,
    );

    const scored = res.approvals
      .map((a) => ({
        a,
        r: assessRisk({
          approval: a,
          ageDays: ageInDays(a.lastUpdatedBlock, res.latestBlock, res.secondsPerBlock),
          knownSpender: spenderLabel(a.spender) !== null,
        }),
      }))
      .sort((x, y) => y.r.score - x.r.score);

    const counts = {high: 0, medium: 0, low: 0};
    for (const s of scored) counts[s.r.level]++;
    if (scored.length) console.log(`  risk: ${counts.high} high / ${counts.medium} med / ${counts.low} low`);
    for (const s of scored.slice(0, 5)) {
      console.log(
        `   [${s.r.level.toUpperCase().padEnd(6)} ${String(s.r.score).padStart(3)}] ${s.a.symbol.padEnd(10)} ` +
          `-> ${(spenderLabel(s.a.spender) ?? shortAddress(s.a.spender)).padEnd(18)} ` +
          `${formatAllowance(s.a).padEnd(10)} | ${s.r.reasons.map((x) => x.label).join(" + ")}`,
      );
    }
  } catch (error) {
    console.log(`\n${wallet}\n  FAILED: ${(error as Error).message.slice(0, 240)}`);
  }
}
