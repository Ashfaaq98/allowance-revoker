"use client";

import { useState } from "react";
import { type Address, isAddress } from "viem";
import { Button } from "./primitives";

/**
 * Read-only address lookup. Available on the landing page AND on the dashboard, so a wallet
 * can be swapped without going back — the earlier version stranded you on whichever address
 * you first opened.
 */
export function AddressInput({
  onSubmit,
  size = "md",
  placeholder = "0x…",
  autoFocus = false,
}: {
  onSubmit: (address: Address) => void;
  size?: "sm" | "md";
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const valid = isAddress(trimmed);
  const dirty = trimmed.length > 0;

  function submit() {
    if (!valid) return;
    onSubmit(trimmed as Address);
    setValue("");
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          id={size === "md" ? "inspect" : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
           
          autoFocus={autoFocus}
          aria-label="Wallet address to inspect"
          aria-invalid={dirty && !valid}
          className={`min-w-0 flex-1 rounded-md border bg-void font-mono text-ink outline-none placeholder:text-ink-faint focus:border-monad/60 ${
            dirty && !valid ? "border-risk-high/50" : "border-line"
          } ${size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"}`}
        />
        <Button size={size} disabled={!valid} onClick={submit}>
          Scan
        </Button>
      </div>
      {dirty && !valid && (
        <span className="font-mono text-[10px] text-risk-high">
          Not a valid address
        </span>
      )}
    </div>
  );
}
