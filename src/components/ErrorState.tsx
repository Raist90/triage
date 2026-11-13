import { CircleSlash } from "lucide-react";
import { Button } from "./ui";

type ErrorStateProps = {
  message: string;
  retrying?: boolean;
  onRetry: () => void;
};

export function ErrorState({ message, retrying, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <CircleSlash className="size-5 text-fg-faint" aria-hidden />
      <p className="text-ui text-fg">Can’t reach the Triage server</p>
      <p className="max-w-sm text-meta text-fg-faint">{message}</p>
      <Button
        variant="outline"
        onClick={onRetry}
        disabled={retrying}
        className="mt-1"
      >
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
