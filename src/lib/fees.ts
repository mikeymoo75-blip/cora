import type { MarketKind } from "./types";

export type FeeBreak = {
  venue: number;
  regulatory: number;
  gas: number;
  total: number;
  note: string;
};

function gasFor(symbol: string, kind: MarketKind): number {
  if (kind === "stock") return 0;
  if (kind === "pump") return 0.12;
  const s = symbol.replace(/-USD$/, "").toUpperCase();
  if (s === "BTC") return 2.4;
  if (s === "ETH") return 0.85;
  if (s === "SOL") return 0.04;
  return 0.18;
}

/** Realistic retail all-in costs. Stocks assume $0 commission (Alpaca-style). */
export function calcFees(
  kind: MarketKind,
  side: "buy" | "sell",
  symbol: string,
  qty: number,
  notional: number,
): FeeBreak {
  if (kind === "stock") {
    const sec = side === "sell" ? notional * 0.0000278 : 0;
    const taf = side === "sell" ? Math.min(8.3, qty * 0.000166) : 0;
    const total = sec + taf;
    return {
      venue: 0,
      regulatory: sec + taf,
      gas: 0,
      total,
      note: side === "sell" ? "SEC fee + FINRA TAF" : "$0 commission",
    };
  }
  if (kind === "crypto") {
    const venue = notional * 0.001;
    const gas = gasFor(symbol, kind);
    return {
      venue,
      regulatory: 0,
      gas,
      total: venue + gas,
      note: "0.10% taker + network fee",
    };
  }
  const venue = notional * 0.01;
  const gas = gasFor(symbol, kind);
  return {
    venue,
    regulatory: 0,
    gas,
    total: venue + gas,
    note: "Pump.fun 1% + Solana gas",
  };
}

/** Round-trip cost. Skip a buy if fees would eat more than 2.5% of the ticket. */
export function roundTripFee(
  kind: MarketKind,
  symbol: string,
  notional: number,
): number {
  const buy = calcFees(kind, "buy", symbol, 1, notional);
  const sell = calcFees(kind, "sell", symbol, 1, notional);
  return buy.total + sell.total;
}

export function minTicketUsd(kind: MarketKind, symbol: string): number {
  if (kind === "stock") return 8;
  if (kind === "pump") return 8;
  const s = symbol.replace(/-USD$/, "").toUpperCase();
  if (s === "BTC") return 50;
  if (s === "ETH") return 25;
  return 15;
}

export function feeWouldEat(kind: MarketKind, symbol: string, notional: number): boolean {
  if (notional <= 0) return true;
  const cap = kind === "pump" ? 0.08 : 0.025;
  return roundTripFee(kind, symbol, notional) > notional * cap;
}
