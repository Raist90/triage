function initials(name: string): string {
  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  const single = parts[0] ?? name;
  return single.slice(0, 2).toUpperCase();
}

/**
 * 22px author mark: the GitHub avatar when the payload carries one, otherwise
 * initials in mono, lit from above like other chrome.
 */
export function Avatar({ name, src }: { name: string; src?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        aria-hidden="true"
        className="size-5.5 shrink-0 rounded-full border border-line lit object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-5.5 shrink-0 items-center justify-center rounded-full border border-line lit font-mono text-micro text-fg-muted"
    >
      {initials(name)}
    </span>
  );
}
