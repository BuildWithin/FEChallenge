import { ArrowUpIcon } from "@/components/icons/arrow-up";

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled: boolean;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="flex items-center gap-2 rounded-xl shadow-sm border border-line bg-surface p-2"
    >
      <input
        className="h-9 flex-1 rounded-md border border-line-strong px-3 text-[0.9375rem] outline-none transition focus:border-accent focus:ring-2 focus:ring-ring"
        placeholder="Ask the analytics copilot…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="submit"
        disabled={disabled}
        aria-label="Send"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        <ArrowUpIcon className="h-4 w-4" />
      </button>
    </form>
  );
}
