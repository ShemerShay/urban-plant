"use client";

import { useSyncExternalStore } from "react";

import {
  CATALOG_CART_STORAGE_KEY,
  EMPTY_CATALOG_CART,
  parseCatalogCart,
  type CatalogCart,
} from "@/lib/catalogCart";

const listeners = new Set<() => void>();

let memory: CatalogCart = EMPTY_CATALOG_CART;
let memoryRaw: string | null | undefined;

function readRaw(): string | null {
  try {
    return localStorage.getItem(CATALOG_CART_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): CatalogCart {
  const raw = readRaw();
  if (raw === memoryRaw) return memory;
  memoryRaw = raw;
  memory = parseCatalogCart(raw);
  return memory;
}

function getServerSnapshot(): CatalogCart {
  return EMPTY_CATALOG_CART;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCatalogCart(): CatalogCart {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function writeCatalogCart(cart: CatalogCart): void {
  const next = cart.items.length === 0 ? EMPTY_CATALOG_CART : cart;
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(CATALOG_CART_STORAGE_KEY, raw);
  } catch {
    // Private mode / blocked storage — keep the in-memory cart for this tab.
  }
  memoryRaw = raw;
  memory = next;
  listeners.forEach((listener) => listener());
}
