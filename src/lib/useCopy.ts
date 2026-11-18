import { useEffect, useRef, useState } from "react";

/**
 * Clipboard copy with a short "Copied" flash. The timer is owned here so an
 * unmount during the flash cannot set state on a gone component.
 */
export function useCopy(text: string, flashMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), flashMs);
  }

  return { copied, copy };
}
