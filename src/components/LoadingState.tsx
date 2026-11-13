import { LoaderCircle } from "lucide-react";

type LoadingStateProps = {
  label: string;
};

export function LoadingState({ label }: LoadingStateProps) {
  return (
    <div
      role="status"
      className="flex h-full items-center justify-center gap-2 text-meta text-fg-faint"
    >
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}
