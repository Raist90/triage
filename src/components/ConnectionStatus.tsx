export type ConnectionState = "connecting" | "connected" | "disconnected";

const LABELS: Record<ConnectionState, string> = {
  connecting: "Connecting",
  connected: "Connected",
  disconnected: "Disconnected",
};

const DOTS: Record<ConnectionState, string> = {
  connected: "bg-accent",
  connecting: "bg-fg-faint",
  disconnected: "bg-danger",
};

type ConnectionStatusProps = {
  state: ConnectionState;
};

export function ConnectionStatus({ state }: ConnectionStatusProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      title={LABELS[state]}
      className="flex shrink-0 items-center gap-2 text-micro text-fg-faint"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${DOTS[state]}`}
      />
      {LABELS[state]}
    </span>
  );
}
