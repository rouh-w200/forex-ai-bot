/**
 * Autonomous Scalping Bot — targets up to 500 trades/day
 * Scans all 7 symbols every 60s. Each symbol has a persistent
 * market regime (BULL / BEAR / RANGE) that drifts over time,
 * giving Claude coherent data to make high-confidence decisions.
 * Daily count resets automatically at midnight — no manual restart needed.
 */

import { db, tradesTable, botSignalsTable } from "@workspace/db";
import { eq, and, gte, lte, count, desc, isNotNull } from "drizzle-orm";
import { getScalpingSignal, type MarketData } from "./trading-ai";
import { logger } from "./logger";
import {
  isOandaConnected,
  placeOandaOrder,
  getOandaPrices,
  getOandaClosedTrade,
  getOandaOpenTrades,
} from "./oanda-bridge";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_DAILY_TRADES  = 1000;
const DAILY_TARGET      = 800;        // aim for 800 quality trades/day
const SIGNAL_INTERVAL   = 60_000;     // scan every 60 seconds
const CLOSE_INTERVAL    = 20_000;     // check closures every 20 seconds
const MAX_OPEN          = 15;         // max concurrent positions (capped to 1 per symbol)
const MAX_PER_CYCLE     = 8;          // max new trades per scan cycle

const SYMBOLS = [
  // Majors
  "EURUSD", "GBPUSD", "USDJPY", "USDCAD", "AUDUSD", "USDCHF", "NZDUSD",
  // Yen crosses
  "GBPJPY", "EURJPY", "AUDJPY", "NZDJPY",
  // Euro crosses
  "EURGBP", "EURAUD", "EURCAD",
  // Pound cross
  "GBPAUD",
];

// Session-preferred symbols (ordered by liquidity in that session)
const SESSION_SYMBOLS: Record<string, string[]> = {
  LONDON_OPEN:       ["EURUSD", "GBPUSD", "EURGBP", "EURJPY", "GBPJPY", "USDCHF"],
  LONDON:            ["EURUSD", "GBPUSD", "EURGBP", "EURJPY", "GBPJPY", "USDCAD", "USDCHF", "EURAUD", "GBPAUD"],
  LONDON_NY_OVERLAP: ["EURUSD", "GBPUSD", "GBPJPY", "USDCAD", "USDCHF", "EURCAD"],
  NEW_YORK:          ["EURUSD", "GBPUSD", "USDCAD", "USDJPY", "USDCHF", "NZDUSD"],
  NY_CLOSE:          ["EURUSD", "GBPUSD", "USDJPY", "USDCHF"],
  TOKYO:             ["USDJPY", "EURJPY", "GBPJPY", "AUDJPY", "NZDJPY", "AUDUSD", "NZDUSD"],
  SYDNEY:            ["AUDUSD", "NZDUSD", "AUDJPY", "NZDJPY", "EURAUD", "GBPAUD"],
  OFF_HOURS:         ["USDJPY", "AUDJPY", "NZDJPY", "EURUSD"],
};

const PIP: Record<string, number> = {
  // USD quote pairs
  EURUSD: 0.0001, GBPUSD: 0.0001, AUDUSD: 0.0001, NZDUSD: 0.0001,
  // USD base pairs
  USDCAD: 0.0001, USDCHF: 0.0001,
  // JPY pairs
  USDJPY: 0.01, GBPJPY: 0.01, EURJPY: 0.01, AUDJPY: 0.01, NZDJPY: 0.01,
  // Euro crosses
  EURGBP: 0.0001, EURAUD: 0.0001, EURCAD: 0.0001,
  // Pound cross
  GBPAUD: 0.0001,
};

// Fixed risk targets per trade (R:R = 1:2)
const SL_USD = 1.20;
const TP_USD = 2.40;

// $ per pip at 0.01 lot (approximate USD account)
const PIP_VAL: Record<string, number> = {
  EURUSD: 0.10, GBPUSD: 0.10, AUDUSD: 0.10, NZDUSD: 0.10,
  USDCAD: 0.072, USDCHF: 0.112,
  USDJPY: 0.067, GBPJPY: 0.067, EURJPY: 0.067, AUDJPY: 0.067, NZDJPY: 0.067,
  EURGBP: 0.126, EURAUD: 0.062, EURCAD: 0.072,
  GBPAUD: 0.048,
};

// ─── Market Regime ─────────────────────────────────────────────────────────────
// Each symbol has a slow-changing regime that biases its indicators.
// This gives Claude coherent, realistic data to make decisions on.

type Regime = "BULL" | "BEAR" | "RANGE";

interface RegimeState {
  regime: Regime;
  strength: number;   // 0.0–1.0 — how strong the trend is
  ticksLeft: number;  // ticks until regime shift
}

const regimes: Record<string, RegimeState> = {};

function initRegime(sym: string): RegimeState {
  const opts: Regime[] = ["BULL", "BEAR", "BULL", "BEAR", "RANGE"]; // 40% bull, 40% bear, 20% range
  const regime = opts[Math.floor(Math.random() * opts.length)];
  return {
    regime,
    strength: 0.4 + Math.random() * 0.5,
    ticksLeft: 40 + Math.floor(Math.random() * 80), // lasts 40-120 ticks (~40-120 min)
  };
}

for (const sym of SYMBOLS) regimes[sym] = initRegime(sym);

function maybeShiftRegime(sym: string) {
  const r = regimes[sym];
  r.ticksLeft--;
  if (r.ticksLeft <= 0) {
    // Trend continuation is more likely than reversal (realistic markets)
    const continueProb = r.regime === "RANGE" ? 0.3 : 0.4;
    if (Math.random() < continueProb) {
      r.regime = r.regime; // continue
    } else {
      const opts: Regime[] = ["BULL", "BEAR", "RANGE"];
      r.regime = opts[Math.floor(Math.random() * opts.length)];
    }
    r.strength = 0.3 + Math.random() * 0.6;
    r.ticksLeft = 40 + Math.floor(Math.random() * 80);
  }
  // Strength drifts slightly each tick
  r.strength = Math.max(0.2, Math.min(1.0, r.strength + (Math.random() - 0.5) * 0.08));
}

// ─── Market State ─────────────────────────────────────────────────────────────

interface Sym {
  price: number; prevClose: number; openPrice: number;
  rsi: number; rsiPrev: number;
  macdMain: number; macdSignal: number; macdHistPrev: number;
  ema20: number; ema50: number; ema200: number;
  bbPrices: number[];
  adx: number; plusDI: number; minusDI: number;
  vols: number[];
  swingHighs: number[]; swingLows: number[];
  trend: "BULLISH" | "BEARISH" | "SIDEWAYS";
  dxyBias: "USD_STRONG" | "USD_WEAK" | "NEUTRAL";
  riskSentiment: "RISK_ON" | "RISK_OFF" | "NEUTRAL";
  consecutiveLosses: number;
}

const mkt: Record<string, Sym> = {};
const BASE: Record<string, number> = {
  // Majors
  EURUSD: 1.1608, GBPUSD: 1.3400, USDJPY: 143.50,
  USDCAD: 1.3900, AUDUSD: 0.6450, USDCHF: 0.8960, NZDUSD: 0.5940,
  // Yen crosses
  GBPJPY: 192.30, EURJPY: 166.50, AUDJPY: 92.55,  NZDJPY: 85.24,
  // Euro crosses
  EURGBP: 0.8664, EURAUD: 1.7997, EURCAD: 1.6135,
  // Pound cross
  GBPAUD: 2.0775,
};

// ─── Real Price Feed ───────────────────────────────────────────────────────────
// Fetches live exchange rates from open.er-api.com (free, no key needed).
// Updates BASE and snaps mkt prices every 5 minutes so the simulation is always
// anchored to real market values — not hardcoded months-old numbers.

const REAL_PRICE_INTERVAL = 5 * 60 * 1000; // 5 minutes
let lastRealFetch = 0;

async function fetchRealPrices(): Promise<void> {
  // If OANDA is connected, use its tick prices (bid/ask) — more accurate than exchange rates
  if (isOandaConnected()) {
    try {
      const oandaPrices = await getOandaPrices(SYMBOLS);
      const updated: string[] = [];
      for (const [sym, p] of Object.entries(oandaPrices)) {
        if (!mkt[sym]) continue;
        const price = p.mid;
        BASE[sym] = price;
        const s = mkt[sym];
        s.price     = price;
        s.prevClose = price;
        s.openPrice = price;
        s.ema20     = price;
        s.ema50     = price;
        s.ema200    = price;
        s.bbPrices  = Array.from({ length: 20 }, () => price * (1 + (Math.random() - 0.5) * 0.001));
        s.swingHighs = [price * 1.005, price * 1.003, price * 1.007];
        s.swingLows  = [price * 0.995, price * 0.997, price * 0.993];
        updated.push(`${sym}:${price}`);
      }
      lastRealFetch = Date.now();
      logger.info({ prices: updated.join(" | ") }, `✅ OANDA live prices updated (${updated.length} symbols)`);
      return;
    } catch (err) {
      logger.warn({ err }, "OANDA price fetch failed, falling back to open.er-api.com");
    }
  }

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { rates: Record<string, number>; result: string };
    if (data.result !== "success") throw new Error("API returned non-success");
    const r = data.rates;

    const dp5 = (n: number) => parseFloat(n.toFixed(5));
    const dp3 = (n: number) => parseFloat(n.toFixed(3));

    const prices: Partial<Record<string, number>> = {
      // USD quote pairs — price = 1 / rate
      EURUSD: r.EUR ? dp5(1 / r.EUR) : undefined,
      GBPUSD: r.GBP ? dp5(1 / r.GBP) : undefined,
      AUDUSD: r.AUD ? dp5(1 / r.AUD) : undefined,
      NZDUSD: r.NZD ? dp5(1 / r.NZD) : undefined,
      // USD base pairs — price = rate
      USDJPY: r.JPY ? dp3(r.JPY)     : undefined,
      USDCAD: r.CAD ? dp5(r.CAD)     : undefined,
      USDCHF: r.CHF ? dp5(r.CHF)     : undefined,
      // JPY crosses — XXXJPY = JPY_rate / XXX_rate
      GBPJPY: r.JPY && r.GBP ? dp3(r.JPY / r.GBP) : undefined,
      EURJPY: r.JPY && r.EUR ? dp3(r.JPY / r.EUR) : undefined,
      AUDJPY: r.JPY && r.AUD ? dp3(r.JPY / r.AUD) : undefined,
      NZDJPY: r.JPY && r.NZD ? dp3(r.JPY / r.NZD) : undefined,
      // EUR crosses
      EURGBP: r.EUR && r.GBP ? dp5(r.GBP / r.EUR) : undefined,
      EURAUD: r.EUR && r.AUD ? dp5(r.AUD / r.EUR) : undefined,
      EURCAD: r.EUR && r.CAD ? dp5(r.CAD / r.EUR) : undefined,
      // GBP cross
      GBPAUD: r.GBP && r.AUD ? dp5(r.AUD / r.GBP) : undefined,
    };

    const updated: string[] = [];
    for (const [sym, price] of Object.entries(prices)) {
      if (price === undefined || !mkt[sym]) continue;
      BASE[sym] = price;
      const s = mkt[sym];
      // Snap market state to real price — also realign EMAs and swing levels
      s.price     = price;
      s.prevClose = price;
      s.openPrice = price;
      s.ema20     = price;
      s.ema50     = price;
      s.ema200    = price;
      s.bbPrices  = Array.from({ length: 20 }, () => price * (1 + (Math.random() - 0.5) * 0.001));
      s.swingHighs = [price * 1.005, price * 1.003, price * 1.007];
      s.swingLows  = [price * 0.995, price * 0.997, price * 0.993];
      updated.push(`${sym}:${price}`);
    }

    lastRealFetch = Date.now();
    logger.info({ prices: updated.join(" | ") }, `✅ Real prices updated (${updated.length} symbols)`);
  } catch (err) {
    logger.warn({ err }, "⚠️ Real price fetch failed — keeping current prices");
  }
}

async function maybeRefreshRealPrices(): Promise<void> {
  if (Date.now() - lastRealFetch >= REAL_PRICE_INTERVAL) {
    await fetchRealPrices();
  }
}

for (const sym of SYMBOLS) {
  const p = BASE[sym];
  mkt[sym] = {
    price: p, prevClose: p * (1 + (Math.random() - 0.5) * 0.002),
    openPrice: p * (1 + (Math.random() - 0.5) * 0.001),
    rsi: 40 + Math.random() * 20, rsiPrev: 40 + Math.random() * 20,
    macdMain: (Math.random() - 0.5) * 0.0008, macdSignal: (Math.random() - 0.5) * 0.0006,
    macdHistPrev: (Math.random() - 0.5) * 0.0003,
    ema20: p * (1 + (Math.random() - 0.5) * 0.002),
    ema50: p * (1 + (Math.random() - 0.5) * 0.004),
    ema200: p * (1 + (Math.random() - 0.5) * 0.008),
    bbPrices: Array.from({ length: 20 }, () => p * (1 + (Math.random() - 0.5) * 0.003)),
    adx: 22 + Math.random() * 28, plusDI: 14 + Math.random() * 18, minusDI: 14 + Math.random() * 18,
    vols: Array.from({ length: 20 }, () => Math.floor(1000 + Math.random() * 5000)),
    swingHighs: [p * 1.005, p * 1.003, p * 1.007],
    swingLows:  [p * 0.995, p * 0.997, p * 0.993],
    trend: "SIDEWAYS",
    dxyBias: "NEUTRAL",
    riskSentiment: "NEUTRAL",
    consecutiveLosses: 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rand    = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));

function stdDev(arr: number[]): number {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

function getSession(): string {
  const h = new Date().getUTCHours();
  if (h >= 7 && h < 9)   return "LONDON_OPEN";
  if (h >= 9 && h < 12)  return "LONDON";
  if (h >= 12 && h < 13) return "LONDON_NY_OVERLAP";
  if (h >= 13 && h < 17) return "NEW_YORK";
  if (h >= 17 && h < 21) return "NY_CLOSE";
  if (h >= 23 || h < 2)  return "SYDNEY";
  if (h >= 2  && h < 7)  return "TOKYO";
  return "OFF_HOURS";
}

function isKillzone(): boolean {
  const t = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  return (t >= 420 && t < 540) || (t >= 780 && t < 870) || (t >= 900 && t < 960) || (t < 180);
}

function getVolatility(session: string): string {
  if (["LONDON_OPEN", "LONDON_NY_OVERLAP", "NEW_YORK"].includes(session)) return "HIGH";
  if (session === "LONDON") return Math.random() > 0.3 ? "NORMAL" : "HIGH";
  return Math.random() > 0.5 ? "LOW" : "NORMAL";
}

// ─── Regime-biased tick ─────────────────────────────────────────────────────
// Produces indicator values coherent with the current market regime,
// so Claude sees realistic trending/ranging conditions per symbol.

function tick(symbol: string) {
  const s   = mkt[symbol];
  const pip = PIP[symbol];
  const r   = regimes[symbol];

  maybeShiftRegime(symbol);

  // Price drift biased by regime
  const bias = r.regime === "BULL" ? 0.52 + r.strength * 0.06
             : r.regime === "BEAR" ? 0.48 - r.strength * 0.06
             : 0.50;
  s.prevClose = s.price;
  const move = (Math.random() < bias ? 1 : -1) * pip * rand(1, 6) * (0.5 + r.strength * 0.5);
  s.price = parseFloat((s.price + move).toFixed(symbol.includes("JPY") ? 3 : 5));

  // RSI biased to trend range
  const rsiTarget = r.regime === "BULL" ? 55 + r.strength * 15
                  : r.regime === "BEAR" ? 45 - r.strength * 15
                  : 50;
  s.rsiPrev = s.rsi;
  s.rsi = Math.max(20, Math.min(80, s.rsi * 0.85 + rsiTarget * 0.15 + (Math.random() - 0.5) * 6));

  // MACD biased to regime direction
  const macdBias = r.regime === "BULL" ?  0.00004 * r.strength
                 : r.regime === "BEAR" ? -0.00004 * r.strength
                 : 0;
  s.macdHistPrev = s.macdMain - s.macdSignal;
  s.macdMain    += macdBias + (Math.random() - 0.5) * 0.00012;
  s.macdSignal   = s.macdSignal * 0.88 + s.macdMain * 0.12;

  // EMA cascade — regime aligns the stack over time
  s.ema20  = s.ema20  * 0.905 + s.price * 0.095;
  s.ema50  = s.ema50  * 0.962 + s.price * 0.038;
  s.ema200 = s.ema200 * 0.990 + s.price * 0.010;

  // In BULL regime: nudge ema20 above ema50 above ema200
  if (r.regime === "BULL" && r.strength > 0.5) {
    if (s.ema20 < s.ema50)  s.ema20  = s.ema50  * (1 + 0.0002 * r.strength);
    if (s.ema50 < s.ema200) s.ema50  = s.ema200 * (1 + 0.0003 * r.strength);
  }
  if (r.regime === "BEAR" && r.strength > 0.5) {
    if (s.ema20 > s.ema50)  s.ema20  = s.ema50  * (1 - 0.0002 * r.strength);
    if (s.ema50 > s.ema200) s.ema50  = s.ema200 * (1 - 0.0003 * r.strength);
  }

  // ADX higher in trending regimes
  const adxTarget = r.regime === "RANGE" ? 18 + r.strength * 8
                  : 28 + r.strength * 22;
  s.adx = Math.max(12, Math.min(70, s.adx * 0.9 + adxTarget * 0.1 + (Math.random() - 0.5) * 3));

  // DI alignment
  if (r.regime === "BULL") {
    s.plusDI  = Math.max(14, Math.min(48, s.plusDI  + r.strength * 0.8 + (Math.random() - 0.4) * 2));
    s.minusDI = Math.max(8,  Math.min(35, s.minusDI - r.strength * 0.5 + (Math.random() - 0.6) * 2));
  } else if (r.regime === "BEAR") {
    s.plusDI  = Math.max(8,  Math.min(35, s.plusDI  - r.strength * 0.5 + (Math.random() - 0.6) * 2));
    s.minusDI = Math.max(14, Math.min(48, s.minusDI + r.strength * 0.8 + (Math.random() - 0.4) * 2));
  } else {
    s.plusDI  = Math.max(10, Math.min(30, s.plusDI  + (Math.random() - 0.5) * 2));
    s.minusDI = Math.max(10, Math.min(30, s.minusDI + (Math.random() - 0.5) * 2));
  }

  // Volume — elevated during trend
  const volBase  = r.regime === "RANGE" ? 1500 : 2500;
  const volBoost = r.strength * 3000;
  const vol = Math.floor(rand(volBase, volBase + volBoost));
  s.vols.push(vol); if (s.vols.length > 20) s.vols.shift();

  // Bollinger
  s.bbPrices.push(s.price); if (s.bbPrices.length > 20) s.bbPrices.shift();

  // Swing levels
  if (s.price > Math.max(...s.swingHighs)) { s.swingHighs.push(s.price); if (s.swingHighs.length > 5) s.swingHighs.shift(); }
  if (s.price < Math.min(...s.swingLows))  { s.swingLows.push(s.price);  if (s.swingLows.length > 5)  s.swingLows.shift(); }

  s.trend = r.regime === "BULL" ? "BULLISH" : r.regime === "BEAR" ? "BEARISH" : "SIDEWAYS";

  // DXY and risk sentiment shift rarely
  if (Math.random() < 0.03) {
    s.dxyBias       = (["USD_STRONG", "USD_WEAK", "NEUTRAL"] as const)[randInt(0, 2)];
    s.riskSentiment = (["RISK_ON", "RISK_OFF", "NEUTRAL"] as const)[randInt(0, 2)];
  }
}

function buildData(symbol: string, todayCount: number, openPositions: number): MarketData {
  tick(symbol);
  const s       = mkt[symbol];
  const pip     = PIP[symbol];
  const isJpy   = symbol.includes("JPY");
  const dp      = isJpy ? 3 : 5;
  const spreadPips = isJpy ? rand(0.7, 1.8) : rand(0.4, 1.3);
  const spread  = parseFloat((spreadPips * pip).toFixed(dp));
  const bbMean  = s.bbPrices.reduce((a, b) => a + b, 0) / s.bbPrices.length;
  const bbStd   = stdDev(s.bbPrices);
  const volAvg  = Math.floor(s.vols.reduce((a, b) => a + b, 0) / s.vols.length);
  const curVol  = s.vols[s.vols.length - 1];
  const session = getSession();

  return {
    symbol, timeframe: "M5",
    bid: s.price, ask: parseFloat((s.price + spread).toFixed(dp)), spread: spreadPips,
    openPrice: s.openPrice, prevClose: s.prevClose,
    highPrice: parseFloat((s.price + pip * rand(3, 14)).toFixed(dp)),
    lowPrice:  parseFloat((s.price - pip * rand(3, 14)).toFixed(dp)),
    closePrice: s.price,
    ema20: s.ema20, ema50: s.ema50, ema200: s.ema200,
    atr: parseFloat((pip * rand(7, 18)).toFixed(dp)),
    rsi: s.rsi, rsiPrev: s.rsiPrev,
    macdMain: s.macdMain, macdSignal: s.macdSignal,
    macdHistogram: s.macdMain - s.macdSignal, macdHistPrev: s.macdHistPrev,
    bollingerUpper: parseFloat((bbMean + 2 * bbStd).toFixed(dp)),
    bollingerMid:   parseFloat(bbMean.toFixed(dp)),
    bollingerLower: parseFloat((bbMean - 2 * bbStd).toFixed(dp)),
    bollingerWidth: parseFloat(((bbMean + 2 * bbStd) - (bbMean - 2 * bbStd)).toFixed(dp)),
    adx: s.adx, plusDI: s.plusDI, minusDI: s.minusDI,
    volume: curVol, volumeAvg: volAvg, volumeRatio: parseFloat((curVol / volAvg).toFixed(2)),
    swingHigh: Math.max(...s.swingHighs), swingLow: Math.min(...s.swingLows),
    structureBias: s.price > Math.max(...s.swingHighs) * 0.998 ? "BULLISH_BOS"
                 : s.price < Math.min(...s.swingLows)  * 1.002 ? "BEARISH_BOS"
                 : "RANGING",
    nearOrderBlock: Math.random() < 0.32,
    fairValueGap: Math.abs(s.price - s.prevClose) > pip * 4
      ? (s.price > s.prevClose ? "BULLISH_FVG" : "BEARISH_FVG")
      : "NONE",
    liquidityLevel: s.price > Math.max(...s.swingHighs) * 0.9997 ? "ABOVE"
                  : s.price < Math.min(...s.swingLows)  * 1.0003 ? "BELOW"
                  : "NONE",
    session, killzone: isKillzone(), trend: s.trend, volatility: getVolatility(session),
    dxyBias: s.dxyBias, riskSentiment: s.riskSentiment,
    consecutiveLosses: s.consecutiveLosses,
    accountBalance: 10000, accountEquity: 10000, openPositions, todayTradeCount: todayCount,
    dailyTarget: DAILY_TARGET,
  };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function todayRange() {
  const n = new Date(), s = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return { start: s, end: new Date(s.getTime() + 86400000) };
}

async function getTodayCount(): Promise<number> {
  const { start, end } = todayRange();
  const [{ c }] = await db.select({ c: count() }).from(tradesTable)
    .where(and(gte(tradesTable.openedAt, start), lte(tradesTable.openedAt, end)));
  return Number(c) || 0;
}

async function getOpenCount(): Promise<number> {
  const [{ c }] = await db.select({ c: count() }).from(tradesTable)
    .where(eq(tradesTable.status, "OPEN"));
  return Number(c) || 0;
}

// Returns the set of symbols that already have an open position
async function getOpenSymbols(): Promise<Set<string>> {
  const rows = await db.select({ symbol: tradesTable.symbol })
    .from(tradesTable)
    .where(eq(tradesTable.status, "OPEN"));
  return new Set(rows.map(r => r.symbol));
}

async function getConsecLosses(symbol: string): Promise<number> {
  const rows = await db.select().from(tradesTable)
    .where(and(eq(tradesTable.symbol, symbol), eq(tradesTable.status, "CLOSED")))
    .orderBy(desc(tradesTable.closedAt)).limit(5);
  let n = 0;
  for (const r of rows) { if (Number(r.profitLoss ?? 0) < 0) n++; else break; }
  return n;
}

// ─── OANDA → DB Sync ──────────────────────────────────────────────────────────
// At startup: fetch open OANDA trades and link them to unlinked DB trades.
// This repairs any oandaTradeId=NULL that happened due to extraction bugs.

async function syncOandaPositions() {
  if (!isOandaConnected()) return;
  try {
    const oandaTrades = await getOandaOpenTrades();
    if (!oandaTrades.length) return;

    // Get all DB open trades that have no oandaTradeId yet
    const unlinked = await db.select().from(tradesTable)
      .where(and(eq(tradesTable.status, "OPEN")));

    // Build a map: symbol → oanda tradeId
    const oandaBySymbol = new Map<string, string>();
    for (const t of oandaTrades) oandaBySymbol.set(t.instrument, t.tradeId);

    let fixed = 0;
    for (const dbTrade of unlinked) {
      if (dbTrade.oandaTradeId) continue; // already linked
      const oandaId = oandaBySymbol.get(dbTrade.symbol);
      if (!oandaId) continue;
      await db.update(tradesTable)
        .set({ oandaTradeId: oandaId })
        .where(eq(tradesTable.id, dbTrade.id));
      fixed++;
      oandaBySymbol.delete(dbTrade.symbol); // one DB trade per symbol
    }

    if (fixed) logger.info({ fixed }, "🔗 Synced OANDA trades → DB");

    // Close any OANDA trades that have no DB record (orphans from old simulated runs)
    // These are real OANDA positions with no DB counterpart — just log them
    for (const [sym, oandaId] of oandaBySymbol) {
      logger.warn({ sym, oandaId }, "⚠️ Orphan OANDA trade (no DB record) — will track via close loop");
    }
  } catch (err) {
    logger.error({ err }, "OANDA sync error");
  }
}

// ─── Trade Lifecycle ──────────────────────────────────────────────────────────

async function openTrade(symbol: string, d: Awaited<ReturnType<typeof getScalpingSignal>>, data: MarketData) {
  if (d.action === "HOLD") return;
  const pip    = PIP[symbol]    ?? 0.0001;
  const pipVal = PIP_VAL[symbol] ?? 0.10;
  const isJpy  = symbol.includes("JPY");
  // Fixed SL=$1.20 / TP=$2.40 → R:R 1:2, overrides Claude's suggestion
  const sl     = Math.round(SL_USD / pipVal);
  const tp     = Math.round(TP_USD / pipVal);
  const entry  = d.action === "BUY" ? data.ask : data.bid;
  const sl_price = d.action === "BUY"
    ? parseFloat((entry - sl * pip).toFixed(isJpy ? 3 : 5))
    : parseFloat((entry + sl * pip).toFixed(isJpy ? 3 : 5));
  const tp_price = d.action === "BUY"
    ? parseFloat((entry + tp * pip).toFixed(isJpy ? 3 : 5))
    : parseFloat((entry - tp * pip).toFixed(isJpy ? 3 : 5));

  // If OANDA is connected → place a REAL order on the broker
  let oandaTradeId: string | undefined;
  let realEntry = entry;
  if (isOandaConnected()) {
    const result = await placeOandaOrder({
      symbol, direction: d.action, lots: 0.01,
      slPrice: sl_price, tpPrice: tp_price,
    });
    if (result) {
      oandaTradeId = result.oandaTradeId;
      realEntry    = result.entryPrice;
      logger.info({ symbol, oandaTradeId, realEntry }, "🟢 REAL OANDA order executed");
    }
  }

  await db.insert(tradesTable).values({
    symbol, direction: d.action,
    entryPrice: realEntry.toString(), lotSize: "0.01",
    stopLoss: sl_price.toString(), takeProfit: tp_price.toString(),
    stopLossPips: sl.toString(), takeProfitPips: tp.toString(),
    confidence: d.confidence?.toString(), reasoning: d.reasoning,
    riskRewardRatio: d.riskRewardRatio?.toString() ?? (tp / sl).toFixed(2),
    oandaTradeId: oandaTradeId ?? null,
    status: "OPEN", openedAt: new Date(),
  });
  logger.info(
    { symbol, action: d.action, confidence: d.confidence, setup: d.setupType, oanda: !!oandaTradeId },
    oandaTradeId ? "✅ Trade opened on OANDA (REAL)" : "📋 Trade opened (simulation)"
  );
}

async function closeMaturedTrades() {
  const open = await db.select().from(tradesTable).where(eq(tradesTable.status, "OPEN"));
  const now  = Date.now();

  for (const trade of open) {
    const sym    = trade.symbol;
    const pip    = PIP[sym]    ?? 0.0001;
    const pv     = PIP_VAL[sym] ?? 0.10;
    const entry  = Number(trade.entryPrice);
    const isJpy  = sym.includes("JPY");
    const dir    = trade.direction as "BUY" | "SELL";
    const sl     = Number(trade.stopLossPips  ?? 10);
    const tp     = Number(trade.takeProfitPips ?? 20);

    // ── OANDA mode: check if SL/TP was hit on the real broker ──
    if (isOandaConnected() && trade.oandaTradeId) {
      const closed = await getOandaClosedTrade(trade.oandaTradeId);
      if (closed) {
        const closePips = dir === "BUY"
          ? (closed.closePrice - entry) / pip
          : (entry - closed.closePrice) / pip;

        await db.update(tradesTable).set({
          closePrice:     closed.closePrice.toString(),
          profitLoss:     closed.profitLoss.toFixed(2),
          profitLossPips: closePips.toFixed(1),
          closeReason:    closed.closeReason,
          status:         "CLOSED",
          closedAt:       closed.closedAt,
        }).where(eq(tradesTable.id, trade.id));

        const isWin = closed.profitLoss > 0;
        if (mkt[sym]) mkt[sym].consecutiveLosses = isWin ? 0 : mkt[sym].consecutiveLosses + 1;
        logger.info(
          { id: trade.id, sym, reason: closed.closeReason, pl: closed.profitLoss, pips: closePips.toFixed(1) },
          "🟢 OANDA trade closed (REAL)"
        );
      }
      continue; // OANDA manages its own trade lifecycle — don't simulate
    }

    // ── Simulation mode: probabilistic close ──
    const elapsed = (now - new Date(trade.openedAt).getTime()) / 60000; // minutes
    if (elapsed < 3) continue;

    const prob = Math.min(0.95, (elapsed - 3) / 32);
    if (Math.random() > prob) continue;

    const conf      = Number(trade.confidence ?? 70);
    const winChance = Math.min(0.80, Math.max(0.48, conf / 100 * 1.1));
    const isWin     = Math.random() < winChance;

    const closePips   = isWin ? tp * rand(0.88, 1.0) : -sl * rand(0.90, 1.0);
    const closeReason = isWin ? "TP_HIT" : "SL_HIT";
    const closePrice  = dir === "BUY"
      ? parseFloat((entry + closePips * pip).toFixed(isJpy ? 3 : 5))
      : parseFloat((entry - closePips * pip).toFixed(isJpy ? 3 : 5));
    const profitLoss  = parseFloat((closePips * pv).toFixed(2));

    await db.update(tradesTable).set({
      closePrice: closePrice.toString(), profitLoss: profitLoss.toString(),
      profitLossPips: closePips.toFixed(1), closeReason, status: "CLOSED", closedAt: new Date(),
    }).where(eq(tradesTable.id, trade.id));

    if (mkt[sym]) mkt[sym].consecutiveLosses = isWin ? 0 : mkt[sym].consecutiveLosses + 1;
    logger.info({ id: trade.id, sym, closeReason, pl: profitLoss, pips: closePips.toFixed(1) }, "📋 Trade closed (simulation)");
  }
}

// ─── Signal Loop ──────────────────────────────────────────────────────────────

async function signalLoop() {
  try {
    // Refresh real market prices every 5 minutes
    await maybeRefreshRealPrices();

    const [todayCount, openCount, openSymbols] = await Promise.all([
      getTodayCount(), getOpenCount(), getOpenSymbols(),
    ]);
    if (todayCount >= MAX_DAILY_TRADES) { logger.info("Daily limit reached"); return; }
    if (openCount  >= MAX_OPEN)         { logger.info({ openCount }, "Max positions open"); return; }

    const session = getSession();

    // Reduce activity only in very quiet overnight periods
    if (session === "OFF_HOURS" && Math.random() > 0.30) return;
    if (session === "SYDNEY"    && Math.random() > 0.55) return;

    // Scan all 7 symbols — session-preferred first (most liquid for that session at top)
    const preferred = SESSION_SYMBOLS[session] ?? SYMBOLS;
    const toScan: string[] = [
      ...preferred,
      ...SYMBOLS.filter(s => !preferred.includes(s)),
    ];

    // Fetch consecutive losses for each symbol in parallel
    const lossMap = Object.fromEntries(
      await Promise.all(toScan.map(async sym => [sym, await getConsecLosses(sym)]))
    );
    for (const sym of toScan) if (mkt[sym]) mkt[sym].consecutiveLosses = lossMap[sym] ?? 0;

    // Build regime-biased market data for each symbol
    const marketDataMap = Object.fromEntries(
      toScan.map(sym => [sym, buildData(sym, todayCount, openCount)])
    );

    // Call Claude in parallel for all symbols
    const results = await Promise.all(
      toScan.map(async sym => {
        const decision = await getScalpingSignal(marketDataMap[sym]);
        return { sym, decision, data: marketDataMap[sym] };
      })
    );

    // Log all signals to DB
    await Promise.all(results.map(({ sym, decision, data }) =>
      db.insert(botSignalsTable).values({
        symbol: sym, timeframe: "M5", action: decision.action,
        confidence: decision.confidence?.toString(), reasoning: decision.reasoning,
        stopLossPips: decision.stopLossPips?.toString(),
        takeProfitPips: decision.takeProfitPips?.toString(),
        lotSize: "0.01", riskRewardRatio: decision.riskRewardRatio?.toString(),
        rsi: data.rsi.toString(), spread: data.spread.toString(),
        session: data.session, trend: data.trend, volatility: data.volatility,
      })
    ));

    // Rank BUY/SELL signals by confidence — only symbols WITHOUT an open position (1 per symbol rule)
    const actionable = results
      .filter(r => r.decision.action !== "HOLD" && !openSymbols.has(r.sym))
      .sort((a, b) => (b.decision.confidence ?? 0) - (a.decision.confidence ?? 0));

    const holds   = results.filter(r => r.decision.action === "HOLD");
    const skipped = results.filter(r => r.decision.action !== "HOLD" && openSymbols.has(r.sym));
    logger.info(
      {
        scanned: results.length,
        actionable: actionable.length,
        hold: holds.length,
        skipped_already_open: skipped.map(r => r.sym).join(", ") || "none",
        ranking: actionable.map(r =>
          `${r.sym}(${r.decision.action} ${r.decision.confidence}%)`
        ).join(", ") || "none",
      },
      "Signal scan complete — 1 position per symbol enforced"
    );

    // Open top N best setups (cap by MAX_PER_CYCLE and available capacity)
    const slotsAvailable = MAX_OPEN - openCount;
    const slotsToFill    = Math.min(MAX_PER_CYCLE, slotsAvailable, MAX_DAILY_TRADES - todayCount);
    let newTrades = 0;

    for (const { sym, decision, data } of actionable) {
      if (newTrades >= slotsToFill) break;
      // Double-check: skip if another trade opened this symbol in this same cycle
      if (openSymbols.has(sym)) continue;
      await openTrade(sym, decision, data);
      openSymbols.add(sym); // mark as occupied for rest of this cycle
      newTrades++;
    }

    if (newTrades === 0 && actionable.length === 0) {
      logger.info({ session }, "No quality setup found this cycle — waiting");
    }
  } catch (err) {
    logger.error({ err }, "Signal loop error");
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

export function startAutonomousBot() {
  if (process.env["BOT_ENABLED"] === "false") {
    logger.warn("🛑 Bot disabilitato (BOT_ENABLED=false) — avvia con BOT_ENABLED=true");
    return;
  }
  logger.info(
    { target: DAILY_TARGET, interval: `${SIGNAL_INTERVAL / 1000}s`, symbols: SYMBOLS.length },
    "🤖 Scalping bot started"
  );

  // Fetch real prices immediately on startup, then every 5 min via signalLoop
  fetchRealPrices().catch(e => logger.warn({ err: e }, "Initial real price fetch failed"));

  // Sync OANDA → DB on startup and every 5 min to repair missing oandaTradeIds
  syncOandaPositions().catch(e => logger.error({ err: e }, "Initial OANDA sync failed"));
  setInterval(() => syncOandaPositions().catch(e => logger.error(e)), 5 * 60_000);

  // Close loop: runs every 20s to quickly free up position slots
  closeMaturedTrades().catch(e => logger.error(e));
  setInterval(() => closeMaturedTrades().catch(e => logger.error(e)), CLOSE_INTERVAL);

  // Signal loop: first scan after 10s (after real prices loaded), then every 60s
  setTimeout(() => {
    signalLoop().catch(e => logger.error(e));
    setInterval(() => signalLoop().catch(e => logger.error(e)), SIGNAL_INTERVAL);
  }, 10_000);
}
