import assert from "node:assert/strict";
import test from "node:test";
import type {Address} from "viem";
import {assessRisk, UNLIMITED_THRESHOLD} from "../lib/riskScore";
import type {Approval} from "../lib/scanApprovals";

const token = "0x0000000000000000000000000000000000000001" as Address;
const spender = "0x0000000000000000000000000000000000000002" as Address;

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    kind: "ERC20",
    token,
    spender,
    amount: 100n,
    lastUpdatedBlock: 1n,
    symbol: "TEST",
    name: "Test Token",
    decimals: 18,
    listed: true,
    ...overrides,
  };
}

test("unlimited unknown approvals are high risk", () => {
  const risk = assessRisk({
    approval: approval({amount: UNLIMITED_THRESHOLD, listed: false}),
    ageDays: 200,
    knownSpender: false,
  });

  assert.equal(risk.level, "high");
  assert.equal(risk.score, 80);
});

test("bounded approvals to a recognised spender remain low risk", () => {
  const risk = assessRisk({approval: approval(), ageDays: 2, knownSpender: true});

  assert.equal(risk.level, "low");
  assert.equal(risk.score, 0);
});

test("collection approvals receive the full-access risk signal", () => {
  const risk = assessRisk({
    approval: approval({kind: "ERC721", amount: 1n}),
    ageDays: null,
    knownSpender: true,
  });

  assert.equal(risk.level, "medium");
  assert.equal(risk.score, 50);
  assert.equal(risk.reasons[0]?.label, "Full collection access");
});
