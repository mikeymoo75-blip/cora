import { createServerFn } from "@tanstack/react-start";
import type { DeskSnapshot, StrategyId } from "./types";

async function rt() {
  const mod = await import("./runtime");
  mod.startDeskLoop();
  return mod;
}

export const loadDesk = createServerFn({ method: "POST" }).handler(
  async (): Promise<DeskSnapshot> => {
    const m = await rt();
    return m.snapshot();
  },
);

export const placeOrder = createServerFn({ method: "POST" })
  .validator((input: { side: "buy" | "sell"; symbol: string; notional: number }) => input)
  .handler(async ({ data }): Promise<DeskSnapshot> => {
    const m = await rt();
    return m.placeOrder(data.side, data.symbol, data.notional);
  });

export const toggleBot = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<DeskSnapshot> => {
    const m = await rt();
    return m.toggleBot(data.id);
  });

export const addBot = createServerFn({ method: "POST" })
  .validator(
    (input: { name: string; symbol: string; strategy: StrategyId; sizeUsd: number }) => input,
  )
  .handler(async ({ data }): Promise<DeskSnapshot> => {
    const m = await rt();
    return m.addBot(data);
  });

export const removeBot = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<DeskSnapshot> => {
    const m = await rt();
    return m.removeBot(data.id);
  });

export const resetBook = createServerFn({ method: "POST" })
  .validator((input: { name?: string } = {}) => input)
  .handler(async ({ data }): Promise<DeskSnapshot> => {
    const m = await rt();
    return m.resetBook(data?.name);
  });

export const addSymbol = createServerFn({ method: "POST" })
  .validator((input: { symbol: string }) => input)
  .handler(async ({ data }): Promise<DeskSnapshot> => {
    const m = await rt();
    return m.addSymbol(data.symbol);
  });

export const resumeHalt = createServerFn({ method: "POST" }).handler(
  async (): Promise<DeskSnapshot> => {
    const m = await rt();
    return m.resumeHalt();
  },
);
