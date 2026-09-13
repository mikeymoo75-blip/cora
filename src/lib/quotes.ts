import { createServerFn } from "@tanstack/react-start";
import { fetchMarketSnapshot } from "./quotes-core";
import type { Quote } from "./types";

export const getMarketSnapshot = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ quotes: Quote[]; live: boolean; at: number }> => {
    return fetchMarketSnapshot();
  },
);
