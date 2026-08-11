"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { filterTelAvivStreetSuggestions } from "@/lib/telAvivStreetSearch";

const baseInputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

const invalidInputClass = "border-red-400 focus:border-red-500 focus:ring-red-200/60";

interface StreetSearchSelectProps {
  id: string;
  value: string;
  error?: string;
  onChange: (street: string) => void;
  onBlur?: () => void;
}

export function StreetSearchSelect({ id, value, error, onChange, onBlur }: StreetSearchSelectProps) {
  const listboxId = useId();
  const optionIdPrefix = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  /** null = show controlled `value`; string = user is editing the query */
  const [draftQuery, setDraftQuery] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const query = draftQuery ?? value;
  const results = useMemo(() => filterTelAvivStreetSuggestions(query), [query]);
  const errorId = `${id}-error`;
  const safeHighlight =
    results.length === 0 ? -1 : Math.min(highlightIndex, results.length - 1);
  const activeOptionId =
    isOpen && safeHighlight >= 0 ? `${optionIdPrefix}-opt-${safeHighlight}` : undefined;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function selectStreet(hebrewStreet: string) {
    onChange(hebrewStreet);
    setDraftQuery(null);
    setIsOpen(false);
    setHighlightIndex(0);
  }

  function handleBlur() {
    window.setTimeout(() => {
      if (!rootRef.current?.contains(document.activeElement)) {
        setIsOpen(false);
        setDraftQuery(null);
        onBlur?.();
      }
    }, 0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setIsOpen(true);
      setHighlightIndex(0);
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
      setDraftQuery(null);
      return;
    }

    if (!isOpen || results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (event.key === "Enter" && safeHighlight >= 0) {
      event.preventDefault();
      selectStreet(results[safeHighlight].value);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        name={id}
        type="text"
        role="combobox"
        dir="auto"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-required="true"
        aria-invalid={error ? true : undefined}
        aria-activedescendant={activeOptionId}
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        className={`${baseInputClass} ${error ? invalidInputClass : ""}`}
        value={query}
        placeholder="Search street..."
        onChange={(event) => {
          const next = event.target.value;
          setDraftQuery(next);
          setIsOpen(true);
          setHighlightIndex(0);
          if (value && next !== value) {
            onChange("");
          }
        }}
        onFocus={() => {
          setIsOpen(true);
          setHighlightIndex(0);
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />

      {isOpen && query.trim() && results.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {results.map((suggestion, index) => (
            <li
              key={suggestion.value}
              id={`${optionIdPrefix}-opt-${index}`}
              role="option"
              aria-selected={index === safeHighlight}
              dir="auto"
            >
              <button
                type="button"
                tabIndex={-1}
                className={`w-full min-h-11 px-4 py-2.5 text-start text-sm text-slate-800 transition hover:bg-emerald-50 focus:outline-none focus-visible:bg-emerald-50 ${
                  index === safeHighlight ? "bg-emerald-50" : ""
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectStreet(suggestion.value)}
                onMouseEnter={() => setHighlightIndex(index)}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {isOpen && query.trim() && results.length === 0 ? (
        <p
          className="absolute z-20 mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-lg"
          role="status"
        >
          No matching streets
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
