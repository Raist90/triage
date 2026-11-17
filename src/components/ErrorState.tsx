import { CircleSlash } from "lucide-react";
import { StateView } from "./StateView";
import { Button } from "./ui";

type ErrorStateProps = {
  title?: string;
  message: string;
  retrying?: boolean;
  onRetry: () => void;
};

export function ErrorState({
  title = "Can’t reach the Triage server",
  message,
  retrying,
  onRetry,
}: ErrorStateProps) {
  return (
    <StateView
      role="alert"
      tone="danger"
      icon={CircleSlash}
      title={title}
      description={message}
      action={
        <Button
          variant="outline"
          onClick={onRetry}
          disabled={retrying}
          className="mt-1"
        >
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      }
    />
  );
}
