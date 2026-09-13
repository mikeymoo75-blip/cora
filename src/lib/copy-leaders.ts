export type LeaderKind = "congress" | "spouse" | "public";

export type CopyLeader = {
  id: string;
  name: string;
  role: string;
  kind: LeaderKind;
  needles: string[];
  /** Public-figure bots that don't file STOCK Act — hold these names. */
  tickers?: string[];
  blurb: string;
};

export const COPY_LEADERS: CopyLeader[] = [
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
