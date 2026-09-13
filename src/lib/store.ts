import { useCallback, useEffect, useState } from "react";
import {
  addBot,
  addSymbol,
  loadDesk,
  placeOrder,
  removeBot,
  resetBook,
  resumeHalt,
  saveReport,
  toggleBot,
} from "./desk-api";
import type { DeskSnapshot, ScanScope, StrategyId } from "./types";

export function useServerDesk() {
  const [desk, setDesk] = useState<DeskSnapshot | null>(null);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await loadDesk();
      setDesk(next);
      setErr("");
    } catch {
      setErr("Can't reach the server desk");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const run = useCallback(async (fn: () => Promise<DeskSnapshot>) => {
    try {
      const next = await fn();
      setDesk(next);
      setErr("");
      return next;
    } catch {
      setErr("That action failed");
      return null;
    }
  }, []);

  return {
    desk,
    err,
    refresh,
    trade: (side: "buy" | "sell", symbol: string, notional: number, close = false) =>
      run(() => placeOrder({ data: { side, symbol, notional, close } })),
    toggleBot: (id: string) => run(() => toggleBot({ data: { id } })),
    addBot: (input: {
      name: string;
      symbol: string;
      strategy: StrategyId;
      sizeUsd: number;
      scope?: ScanScope;
      maxNames?: number;
    }) => run(() => addBot({ data: input })),
    removeBot: (id: string) => run(() => removeBot({ data: { id } })),
    addSymbol: (symbol: string) => run(() => addSymbol({ data: { symbol } })),
    reset: (name?: string) => run(() => resetBook({ data: { name } })),
    resume: () => run(() => resumeHalt()),
    saveReport: () => run(() => saveReport()),
  };
}
