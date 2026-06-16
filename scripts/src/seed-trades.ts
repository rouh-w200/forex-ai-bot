import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { tradesTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

type Direction = "BUY" | "SELL";
type CloseReason = "TP_HIT" | "SL_HIT" | "TRAILING_STOP";

const SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "USDCAD", "AUDUSD", "GBPJPY", "EURJPY"];

const PIP_VALUE: Record<string, number> = {
  EURUSD: 10,
  GBPUSD: 10,
  AUDUSD: 10,
  USDCAD: 7.5,
  USDJPY: 6.7,
  GBPJPY: 6.7,
  EURJPY: 6.7,
};

const BASE_PRICES: Record<string, number> = {
  EURUSD: 1.0850,
  GBPUSD: 1.2640,
  USDJPY: 149.80,
  USDCAD: 1.3620,
  AUDUSD: 0.6580,
  GBPJPY: 189.40,
  EURJPY: 162.50,
};

const REASONINGS = [
  "RSI oversold + EMA crossover — high probability reversal",
  "London breakout with strong momentum — trend continuation",
  "Bearish divergence at daily high — clean reversal setup",
  "EMA20/50 golden cross — bullish continuation confirmed",
  "Resistance rejection with volume spike — scalp short",
  "Support bounce + RSI reset — perfect entry",
  "MACD histogram reversal — momentum shift confirmed",
  "Price action inside bar breakout — directional bias",
  "Asia session liquidity grab — London reversal play",
  "New York open momentum — strong trend continuation",
  "ATR breakout strategy — volatility expansion trade",
  "Fibonacci 61.8% retracement — bounce confirmed",
  "Double bottom pattern + bullish engulfing",
  "Bearish flag breakdown — continuation pattern",
  "Session overlap liquidity — high probability trade",
];

function randBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number) {
  return Math.floor(randBetween(min, max + 1));
}

function addMinutes(date: Date, mins: number) {
  return new Date(date.getTime() + mins * 60000);
}

function generateTrade(openedAt: Date, symbol: string, isWin: boolean) {
  const direction: Direction = Math.random() > 0.5 ? "BUY" : "SELL";
  const basePrice = BASE_PRICES[symbol] + randBetween(-0.005, 0.005);
  const isJpy = symbol.includes("JPY");
  const pipSize = isJpy ? 0.01 : 0.0001;

  const slPips = randBetween(10, 18);
  const tpPips = slPips * randBetween(1.5, 2.5);
  const confidence = randBetween(62, 95);
  const lotSize = 0.1;
  const mtTicket = randInt(100000, 999999);

  let sl: number, tp: number, entry: number;
  entry = parseFloat(basePrice.toFixed(isJpy ? 3 : 5));

  if (direction === "BUY") {
    sl = parseFloat((entry - slPips * pipSize).toFixed(isJpy ? 3 : 5));
    tp = parseFloat((entry + tpPips * pipSize).toFixed(isJpy ? 3 : 5));
  } else {
    sl = parseFloat((entry + slPips * pipSize).toFixed(isJpy ? 3 : 5));
    tp = parseFloat((entry - tpPips * pipSize).toFixed(isJpy ? 3 : 5));
  }

  const durationMins = randInt(8, 55);
  const closedAt = addMinutes(openedAt, durationMins);

  let closePips: number;
  let closeReason: CloseReason;

  if (isWin) {
    closePips = tpPips * randBetween(0.85, 1.0);
    closeReason = "TP_HIT";
  } else {
    closePips = -slPips * randBetween(0.9, 1.0);
    closeReason = "SL_HIT";
  }

  let closePrice: number;
  if (direction === "BUY") {
    closePrice = parseFloat((entry + closePips * pipSize).toFixed(isJpy ? 3 : 5));
  } else {
    closePrice = parseFloat((entry - closePips * pipSize).toFixed(isJpy ? 3 : 5));
  }

  const pipVal = PIP_VALUE[symbol];
  // pipVal = $/pip per standard lot; lotSize=0.1 → $/pip = pipVal * lotSize
  const profitLoss = parseFloat((closePips * pipVal * lotSize).toFixed(2));

  return {
    symbol,
    direction,
    entryPrice: entry.toString(),
    closePrice: closePrice.toString(),
    lotSize: lotSize.toString(),
    stopLoss: sl.toString(),
    takeProfit: tp.toString(),
    stopLossPips: slPips.toFixed(1),
    takeProfitPips: tpPips.toFixed(1),
    profitLoss: profitLoss.toString(),
    profitLossPips: closePips.toFixed(1),
    confidence: confidence.toFixed(2),
    reasoning: REASONINGS[randInt(0, REASONINGS.length - 1)],
    riskRewardRatio: (tpPips / slPips).toFixed(2),
    status: "CLOSED" as const,
    closeReason,
    mtTicket,
    openedAt,
    closedAt,
  };
}

async function main() {
  console.log("Clearing existing trades...");
  await db.execute(sql`DELETE FROM trades WHERE mt_ticket IS NULL OR mt_ticket < 999999`);
  await db.execute(sql`DELETE FROM trades`);

  const today = new Date("2026-05-18T00:00:00Z");
  const allTrades = [];

  // Generate 30 days of history
  for (let dayOffset = 29; dayOffset >= 1; dayOffset--) {
    const dayDate = new Date(today);
    dayDate.setDate(today.getDate() - dayOffset);
    
    // 18-38 trades per day (realistic scalping volume)
    const numTrades = randInt(18, 38);
    // Win rate oscillates between 60-75%
    const winRate = randBetween(0.60, 0.75);
    const numWins = Math.round(numTrades * winRate);

    const outcomes = Array(numWins).fill(true).concat(Array(numTrades - numWins).fill(false));
    // Shuffle outcomes
    for (let i = outcomes.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
    }

    // Spread trades across London (07:00-12:00), NY (13:00-17:00), Asia (01:00-05:00) UTC
    const sessions = [
      { start: 7, end: 12 },    // London
      { start: 13, end: 17 },   // New York
      { start: 1, end: 5 },     // Asia
    ];

    for (let i = 0; i < numTrades; i++) {
      const session = sessions[i % sessions.length];
      const hour = randInt(session.start, session.end - 1);
      const minute = randInt(0, 59);
      const openedAt = new Date(dayDate);
      openedAt.setUTCHours(hour, minute, randInt(0, 59), 0);

      const symbol = SYMBOLS[i % SYMBOLS.length];
      const trade = generateTrade(openedAt, symbol, outcomes[i]);
      allTrades.push(trade);
    }
  }

  // Today's trades (May 18, 2026) — good day so far
  const todayTrades = [
    // Morning session closed wins
    { hour: 7, min: 15, symbol: "EURUSD", win: true },
    { hour: 7, min: 42, symbol: "GBPUSD", win: true },
    { hour: 8, min: 18, symbol: "USDJPY", win: false },
    { hour: 8, min: 55, symbol: "EURUSD", win: true },
    { hour: 9, min: 22, symbol: "GBPJPY", win: true },
    { hour: 9, min: 48, symbol: "AUDUSD", win: true },
    { hour: 10, min: 11, symbol: "GBPUSD", win: false },
    { hour: 10, min: 33, symbol: "EURUSD", win: true },
    { hour: 11, min: 05, symbol: "USDJPY", win: true },
    { hour: 11, min: 38, symbol: "EURJPY", win: true },
    { hour: 12, min: 15, symbol: "GBPUSD", win: true },
    // NY session
    { hour: 13, min: 10, symbol: "EURUSD", win: true },
    { hour: 13, min: 44, symbol: "USDCAD", win: false },
    { hour: 14, min: 22, symbol: "GBPUSD", win: true },
    { hour: 14, min: 55, symbol: "USDJPY", win: true },
  ];

  for (const t of todayTrades) {
    const openedAt = new Date("2026-05-18T00:00:00Z");
    openedAt.setUTCHours(t.hour, t.min, randInt(0, 59), 0);
    const trade = generateTrade(openedAt, t.symbol, t.win);
    allTrades.push(trade);
  }

  // 3 currently OPEN trades (same as seeded before)
  const openTrades = [
    {
      symbol: "EURUSD", direction: "BUY" as Direction,
      entryPrice: "1.08450", closePrice: null,
      lotSize: "0.10", stopLoss: "1.08300", takeProfit: "1.08750",
      stopLossPips: "15.0", takeProfitPips: "30.0",
      profitLoss: null, profitLossPips: null,
      confidence: "81.00", reasoning: "Strong bullish impulse — London session momentum confirmed",
      riskRewardRatio: null, status: "OPEN" as const, closeReason: null,
      mtTicket: randInt(100000, 999999),
      openedAt: new Date("2026-05-18T17:33:55Z"), closedAt: null,
    },
    {
      symbol: "GBPUSD", direction: "SELL" as Direction,
      entryPrice: "1.26320", closePrice: null,
      lotSize: "0.10", stopLoss: "1.26470", takeProfit: "1.25920",
      stopLossPips: "15.0", takeProfitPips: "40.0",
      profitLoss: null, profitLossPips: null,
      confidence: "75.00", reasoning: "Bearish divergence at daily high — high probability reversal",
      riskRewardRatio: null, status: "OPEN" as const, closeReason: null,
      mtTicket: randInt(100000, 999999),
      openedAt: new Date("2026-05-18T18:03:55Z"), closedAt: null,
    },
    {
      symbol: "USDJPY", direction: "BUY" as Direction,
      entryPrice: "149.950", closePrice: null,
      lotSize: "0.10", stopLoss: "149.800", takeProfit: "150.350",
      stopLossPips: "15.0", takeProfitPips: "30.0",
      profitLoss: null, profitLossPips: null,
      confidence: "69.00", reasoning: "JPY weakness — Asia session continuation trade",
      riskRewardRatio: null, status: "OPEN" as const, closeReason: null,
      mtTicket: randInt(100000, 999999),
      openedAt: new Date("2026-05-18T18:48:55Z"), closedAt: null,
    },
  ];

  console.log(`Inserting ${allTrades.length} historical trades...`);
  
  // Insert in batches
  const BATCH = 50;
  for (let i = 0; i < allTrades.length; i += BATCH) {
    const batch = allTrades.slice(i, i + BATCH);
    await db.insert(tradesTable).values(batch as any[]);
  }

  console.log(`Inserting ${openTrades.length} open trades...`);
  await db.insert(tradesTable).values(openTrades as any[]);

  const total = allTrades.length + openTrades.length;
  console.log(`Done! Inserted ${total} trades total.`);
  
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
