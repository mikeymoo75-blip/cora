export type LeaderKind = "congress" | "spouse" | "public" | "star" | "crypto-top";

export type CopyLeader = {
  id: string;
  name: string;
  role: string;
  kind: LeaderKind;
  needles: string[];
  tickers?: string[];
  blurb: string;
};

export const COPY_LEADERS: CopyLeader[] = [
  {
    id: "buffett",
    name: "Warren Buffett",
    role: "Berkshire",
    kind: "star",
    needles: [],
    tickers: ["AAPL", "AXP", "KO", "BAC"],
    blurb: "Warren Buffett / Berkshire. Paper copies AAPL, AXP, KO, BAC from the public 13F. Quarterly and weeks late — not his live clicks. Off until you turn it On.",
  },
  {
    id: "cathie",
    name: "Cathie Wood",
    role: "ARKK",
    kind: "star",
    needles: [],
    tickers: ["TSLA", "COIN", "HOOD"],
    blurb: "Copies ARKK’s public holdings file (the ETF, not her personal account). Updates when ARK publishes.",
  },
  {
    id: "ackman",
    name: "Bill Ackman",
    role: "Pershing Square",
    kind: "star",
    needles: [],
    tickers: ["GOOGL", "CMG"],
    blurb: "Pershing Square concentrated names from public reports. Delayed like any 13F.",
  },
  {
    id: "hl-1",
    name: "Crypto whale #1",
    role: "Hyperliquid",
    kind: "crypto-top",
    needles: [],
    blurb: "Highest Hyperliquid wallet by 30-day PnL. We copy majors they are long. Not Pump.fun, not shorts.",
  },
  {
    id: "hl-2",
    name: "Crypto whale #2",
    role: "Hyperliquid",
    kind: "crypto-top",
    needles: [],
    blurb: "2nd Hyperliquid wallet by 30-day PnL. Paper longs only — skip shorts and coins we cannot quote.",
  },
  {
    id: "hl-3",
    name: "Crypto whale #3",
    role: "Hyperliquid",
    kind: "crypto-top",
    needles: [],
    blurb: "3rd Hyperliquid wallet by 30-day PnL. Ranking updates as the board moves.",
  },
  {
    id: "hl-4",
    name: "Crypto whale #4",
    role: "Hyperliquid",
    kind: "crypto-top",
    needles: [],
    blurb: "4th Hyperliquid wallet by 30-day PnL. Paper longs only.",
  },
  {
    id: "hl-5",
    name: "Crypto whale #5",
    role: "Hyperliquid",
    kind: "crypto-top",
    needles: [],
    blurb: "5th Hyperliquid wallet by 30-day PnL. Paper longs only.",
  },
  {
    id: "pelosi",
    name: "Nancy Pelosi",
    role: "House",
    kind: "congress",
    needles: ["nancy pelosi"],
    blurb: "STOCK Act filings. Often 30–45 days after the real trade.",
  },
  {
    id: "paul-pelosi",
    name: "Paul Pelosi",
    role: "Spouse",
    kind: "spouse",
    needles: ["paul pelosi"],
    blurb: "Spouse filings reported under the STOCK Act.",
  },
  {
    id: "tuberville",
    name: "Tommy Tuberville",
    role: "Senate",
    kind: "congress",
    needles: ["tuberville"],
    blurb: "High-volume Senate periodic transaction reports.",
  },
  {
    id: "gottheimer",
    name: "Josh Gottheimer",
    role: "House",
    kind: "congress",
    needles: ["gottheimer"],
    blurb: "House PTR — delayed public disclosure.",
  },
  {
    id: "crenshaw",
    name: "Dan Crenshaw",
    role: "House",
    kind: "congress",
    needles: ["crenshaw"],
    blurb: "House PTR — delayed public disclosure.",
  },
  {
    id: "greene",
    name: "Marjorie Taylor Greene",
    role: "House",
    kind: "congress",
    needles: ["marjorie taylor greene", "greene, marjorie"],
    blurb: "House PTR — delayed public disclosure.",
  },
  {
    id: "elon",
    name: "Elon Musk",
    role: "Public CEO",
    kind: "public",
    needles: [],
    tickers: ["TSLA"],
    blurb: "No brokerage feed. Holds a public TSLA stake — bot keeps a paper long.",
  },
  {
    id: "trump",
    name: "Donald Trump",
    role: "Public",
    kind: "public",
    needles: [],
    tickers: ["DJT"],
    blurb: "No brokerage feed. Tracks the public DJT ticker only.",
  },
  {
    id: "vance",
    name: "JD Vance",
    role: "Public",
    kind: "public",
    needles: ["vance"],
    tickers: [],
    blurb: "Copies Senate filings when they appear; otherwise idle.",
  },
];
