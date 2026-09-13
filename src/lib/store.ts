import { useCallback, useEffect, useState } from "react";
import {
  addBot,
  loadDesk,
  placeOrder,
  removeBot,
  resetBook,
  resumeHalt,
  toggleBot,
} from "./desk-api";
import type { DeskSnapshot, StrategyId } from "./types";

export function useServerDesk() {
  const [desk, setDesk] = useState<DeskSnapshot | null>(null);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await loadDesk();
      setDesk(next);
      setErr("");
    } catch {
      setErr("Server desk unreachable");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<DeskSnapshot>) => {
      try {
        const next = await fn();
        setDesk(next);
        setErr("");
        return next;
      } catch {
        setErr("Action failed");
        return null;
      }
    },
    [],
  );

  return {
    desk,
    err,
    refresh,
    trade: (side: "buy" | "sell", symbol: string, notional: number) =>
      run(() => placeOrder({ data: { side, symbol, notional } })),
    toggleBot: (id: string) => run(() => toggleBot({ data: { id } })),
    addBot: (input: { name: string; symbol: string; strategy: StrategyId; sizeUsd: number }) =>
      run(() => addBot({ data: input })),
    removeBot: (id: string) => run(() => removeBot({ data: { id } })),
    reset: () => run(() => resetBook()),
    resume: () => run(() => resumeHalt()),
  };
}
