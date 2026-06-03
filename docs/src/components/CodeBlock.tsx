import { useEffect, useId, useState } from "react";
import { highlight } from "../lib/highlighter";

interface Props {
  code: string;
  lang?: string;
  filename?: string;
  className?: string;
}

export function CodeBlock({ code, lang = "yaml", filename, className }: Props) {
  const [html, setHtml] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const id = useId();

  useEffect(() => {
    let alive = true;
    highlight(code, lang).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [code, lang]);

  const copy = async () => {
    await navigator.clipboard.writeText(code.trimEnd());
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div
      className={`group overflow-hidden rounded-xl border border-line bg-ink-2/80 backdrop-blur ${className ?? ""}`}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-mint/70" />
          {filename && (
            <span className="ml-2 font-mono text-xs text-mist">{filename}</span>
          )}
        </div>
        <button
          onClick={copy}
          aria-describedby={id}
          className="rounded-md border border-line px-2.5 py-1 font-mono text-[11px] text-mist transition-colors hover:border-line-2 hover:text-chalk"
        >
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <div className="shiki-wrap" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
