"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

/**
 * The theme lives on <html data-theme>, applied by the inline script in layout.tsx before
 * first paint. That makes it external mutable state as far as React is concerned, so it is
 * read with useSyncExternalStore rather than mirrored into an effect — which would both
 * trip react-hooks/set-state-in-effect and render one frame with the wrong icon.
 *
 * getServerSnapshot returns "dark" to match the server-rendered <html data-theme="dark">,
 * so hydration is consistent even when the visitor's stored preference is light.
 */
let listeners: Array<() => void> = [];

function subscribe(onChange: () => void) {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((l) => l !== onChange);
  };
}

function getSnapshot(): Theme {
  return (document.documentElement.dataset.theme as Theme) ?? "dark";
}

function getServerSnapshot(): Theme {
  return "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Private browsing or blocked storage: the toggle still works for this session.
  }
  for (const listener of listeners) listener();
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      onClick={() => applyTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="inline-flex size-8 items-center justify-center rounded-md border border-line text-ink-dim transition-colors hover:border-line-bright hover:text-ink"
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 2.2v1.6M10 16.2v1.6M17.8 10h-1.6M3.8 10H2.2M15.5 4.5l-1.1 1.1M5.6 14.4l-1.1 1.1M15.5 15.5l-1.1-1.1M5.6 5.6L4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
          <path
            d="M16.5 12.4A7 7 0 0 1 7.6 3.5a7 7 0 1 0 8.9 8.9Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
