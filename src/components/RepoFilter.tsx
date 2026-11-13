import { FolderGit, Inbox } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import type { Repo } from "../lib/types";
import { cx } from "../lib/cx";

type RepoFilterProps = {
  repos: Repo[];
  selectedRepo: string | null;
  onSelect: (repo: string | null) => void;
};

/**
 * Roving-focus repo list. `null` is the synthetic "All repos" entry.
 *
 * `j`/`k` (or arrows) move the cursor and focus, `Enter` commits the selection,
 * `Esc` clears back to "All repos". Keys only apply while the list has focus.
 */
export function RepoFilter({ repos, selectedRepo, onSelect }: RepoFilterProps) {
  const options: (string | null)[] = [
    null,
    ...repos.map((repo) => `${repo.owner}/${repo.name}`),
  ];
  const lastIndex = options.length - 1;

  const selectedIndex = Math.max(0, options.indexOf(selectedRepo));
  const [cursorOverride, setCursorOverride] = useState<number | null>(null);
  const cursor = Math.min(cursorOverride ?? selectedIndex, lastIndex);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusOption(index: number) {
    itemRefs.current[index]?.focus();
  }

  function move(index: number) {
    const next = Math.min(Math.max(index, 0), lastIndex);
    setCursorOverride(next);
    focusOption(next);
  }

  function commit(index: number) {
    setCursorOverride(index);
    onSelect(options[index] ?? null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "j":
      case "ArrowDown":
        event.preventDefault();
        move(cursor + 1);
        break;
      case "k":
      case "ArrowUp":
        event.preventDefault();
        move(cursor - 1);
        break;
      case "Enter":
        event.preventDefault();
        commit(cursor);
        break;
      case "Escape":
        event.preventDefault();
        commit(0);
        focusOption(0);
        break;
      default:
        break;
    }
  }

  return (
    <div>
      <div
        role="listbox"
        aria-label="Repositories"
        onKeyDown={handleKeyDown}
        className="flex flex-col gap-0"
      >
        {options.map((option, index) => {
          const isSelected = option === selectedRepo;
          const label = option ?? "All repos";
          const Icon = option === null ? Inbox : FolderGit;
          return (
            <button
              key={option ?? "all"}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={isSelected}
              tabIndex={index === cursor ? 0 : -1}
              onFocus={() => setCursorOverride(index)}
              onClick={() => commit(index)}
              className={cx(
                "flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-ui transition-colors outline-none",
                isSelected
                  ? "bg-surface text-fg"
                  : "text-fg-muted hover:bg-surface/60 hover:text-fg",
              )}
            >
              <Icon
                className={cx(
                  "size-3.5 shrink-0",
                  isSelected ? "text-accent" : "text-fg-faint",
                )}
                aria-hidden
              />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
      {repos.length === 0 ? (
        <p className="px-2 pt-2 text-meta text-fg-faint">
          No repos configured.
        </p>
      ) : null}
    </div>
  );
}
