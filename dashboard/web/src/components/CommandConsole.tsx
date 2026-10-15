import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store/store";
import { COMMANDS, autocomplete, execCommand } from "../lib/commands";
import type { CommandDef } from "../lib/commands";
const CHIP_CMDS = [
  "/help", "/filter", "/health", "/latency", "/export alerts", "/focus",
];

function CommandConsoleImpl() {
  const layers = useStore((s) => s.layers);
  const [input, setInput] = useState("");
  const [, setHistIdx] = useState(-1);
  const [suggestions, setSuggestions] = useState<CommandDef[]>([]);
  const [cmdHist, setCmdHist] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "/" && document.activeElement === document.body) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const submit = useCallback(() => {
    if (!input.trim()) return;
    execCommand(input);
    setCmdHist((h) => [input, ...h.slice(0, 49)]);
    setInput("");
    setHistIdx(-1);
    setSuggestions([]);
  }, [input]);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { submit(); return; }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHistIdx((i) => {
        const next = Math.min(i + 1, cmdHist.length - 1);
        if (cmdHist[next]) setInput(cmdHist[next]);
        return next;
      });
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHistIdx((i) => {
        const next = Math.max(i - 1, -1);
        setInput(next < 0 ? "" : cmdHist[next] || "");
        return next;
      });
    }
    if (e.key === "Escape") {
      setSuggestions([]);
      inputRef.current?.blur();
    }
    if (e.key === "Tab" && suggestions.length) {
      e.preventDefault();
      setInput(`/${suggestions[0].name} `);
      setSuggestions([]);
    }
  }, [submit, cmdHist, suggestions]);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInput(v);
    setHistIdx(-1);
    setSuggestions(v.length > 0 ? autocomplete(v) : []);
  }, []);

  const layerRows = [
    { k: "Sense", lit: layers.idsCount > 0, v: layers.idsCount },
    { k: "Dev", lit: layers.lanToday > 0, v: layers.lanToday },
    { k: "Anom", lit: layers.wifiLast > 0, v: layers.wifiRogue ? "flag" : "clear" },
    { k: "Auto", lit: layers.tripLast > 0, v: layers.tripSeq },
  ];

  return (
    <div className="cmd-console">
      <div className="cmd-input-wrap">
        <span className="cmd-caret" aria-hidden="true">&gt;</span>
        <input ref={inputRef} className="cmd-input" type="text" value={input}
          onChange={onChange} onKeyDown={onKey} aria-label="Command"
          placeholder="/help" spellCheck={false} autoComplete="off" />
        <button className="cmd-go" onClick={submit} disabled={!input.trim()}>Run</button>
      </div>
      <div className="cmd-hints">
        <kbd>Ctrl K</kbd> focus · <kbd>Tab</kbd> complete · <kbd>↑</kbd><kbd>↓</kbd> history · <kbd>Enter</kbd> run · <kbd>Esc</kbd> clear
      </div>
      {suggestions.length > 0 && (
        <div className="cmd-suggest" role="listbox">
          {suggestions.slice(0, 6).map((s) => (
            <div key={s.name} className={`cmd-sug-row${s.phase2 ? " disabled" : ""}`}
              onClick={() => { if (!s.phase2) { setInput(`/${s.name} `); setSuggestions([]); inputRef.current?.focus(); } }}>
              <span className="cmd-sug-name">/{s.name}</span>
              {s.args && <span className="cmd-sug-args">{s.args}</span>}
              <span className="cmd-sug-desc">{s.desc}</span>
              {s.phase2 && <span className="cmd-sug-ph2">Phase 2</span>}
            </div>
          ))}
        </div>
      )}
      <div className="cmd-chips">
        {CHIP_CMDS.map((c) => (
          <button key={c} className="cmd-chip" onClick={() => { setInput(c); inputRef.current?.focus(); }}>{c}</button>
        ))}
        {COMMANDS.filter((c) => c.phase2).map((c) => (
          <button key={c.name} className="cmd-chip disabled" disabled
            title="Response actions are Phase 2 — notify-only in Phase 1">/{c.name}<span className="cmd-chip-ph">P2</span></button>
        ))}
      </div>
      <div className="cmd-layers">
        {layerRows.map((r) => (
          <div key={r.k} className={`cmd-layer${r.lit ? " lit" : ""}`}>
            <span className="cmd-layer-dot" />
            <span className="cmd-layer-name">{r.k}</span>
            <span className="cmd-layer-val num">{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const CommandConsole = memo(CommandConsoleImpl);
