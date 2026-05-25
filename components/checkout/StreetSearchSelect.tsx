"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { filterTelAvivStreetSuggestions } from "@/lib/telAvivStreetSearch";

const baseInputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

interface StreetSearchSelectProps {
  id: string;
  value: string;
  error?: string;
  onChange: (street: string) => void;
  onBlur?: () => void;
}

export function StreetSearchSelect({ id, value, error, onChange, onBlur }: StreetSearchSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const results = useMemo(() => filterTelAvivStreetSuggestions(query), [query]);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    setHighlightIndex(results.length > 0 ? 0 : -1);
  }, [results]);

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
    setQuery(hebrewStreet);
    setIsOpen(false);
    setHighlightIndex(-1);
  }

  function handleBlur() {
    window.setTimeout(() => {
      if (!rootRef.current?.contains(document.activeElement)) {
        setIsOpen(false);
        if (value) {
          setQuery(value);
        } else {
          setQuery("");
        }
        onBlur?.();
      }
    }, 0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setIsOpen(true);
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
      setQuery(value);
      return;
    }

    if (!isOpen || results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (event.key === "Enter" && highlightIndex >= 0) {
      event.preventDefault();
      selectStreet(results[highlightIndex].value);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        name={id}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        className={baseInputClass}
        value={query}
        placeholder="Search street..."
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setIsOpen(true);
          if (value && next !== value) {
            onChange("");
          }
        }}
        onFocus={() => setIsOpen(true)}
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
            <li key={suggestion.value} role="option" aria-selected={suggestion.value === value}>
              <button
                type="button"
                className={`w-full px-4 py-2.5 text-start text-sm text-slate-800 transition hover:bg-emerald-50 ${
                  index === highlightIndex ? "bg-emerald-50" : ""
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
        <p className="absolute z-20 mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-lg">
          No matching streets
        </p>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
