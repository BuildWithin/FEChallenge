"use client";

const PROMPTS = [
  "How does my pipeline look by stage?",
  "What's our average time-to-hire?",
  "Show stage conversion through the hiring funnel",
  "Which sources produce the most hires vs rejections?",
  "Where are we slowest in the pipeline?",
] as const;

type StarterPromptsProps = {
  disabled?: boolean;
  compact?: boolean;
  onSelect: (prompt: string) => void;
};

export function StarterPrompts({
  disabled,
  compact,
  onSelect,
}: StarterPromptsProps) {
  return (
    <div className={compact ? "flex flex-wrap gap-1.5" : "space-y-3"}>
      {!compact && (
        <div>
          <p className="text-sm font-medium text-gray-700">
            Try a suggested question
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            Click a chip — answers are grounded in this workspace&rsquo;s data.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(prompt)}
            className={
              compact
                ? "rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                : "rounded-xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 px-3 py-2 text-left text-xs text-gray-700 shadow-sm transition hover:border-gray-300 hover:shadow disabled:opacity-50"
            }
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
