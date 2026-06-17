import { logger } from "./logger";

export interface MarketData {
  symbol: string;
  timeframe: string;
  bid: number;
  ask: number;
  spread: number;

  // Price action
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  openPrice?: number;
  prevClose?: number;

  // Trend
  ema20: number;
  ema50: number;
  ema200: number;
  atr?: number;

  // Momentum
  rsi: number;
  rsiPrev?: number;
  macdMain: number;
  macdSignal: number;
  macdHistogram: number;
  macdHistPrev?: number;

  // Volatility
  bollingerUpper?: number;
  bollingerMid?: number;
  bollingerLower?: number;
  bollingerWidth?: number;

  // Strength
  adx?: number;
  plusDI?: number;
  minusDI?: number;

  // Volume
  volume: number;
  volumeAvg?: number;
  volumeRatio?: number;

  // Smart Money
  swingHigh?: number;
  swingLow?: number;
  structureBias?: string;
  nearOrderBlock?: boolean;
  fairValueGap?: string;
  liquidityLevel?: string;

  // Context
  session: string;
  killzone?: boolean;
  trend: string;
  volatility: string;
  dxyBias?: string;
  riskSentiment?: string;

  // State
  consecutiveLosses?: number;
  accountBalance: number;
  accountEquity: number;
  openPositions: number;
  todayTradeCount: number;
  dailyTarget?: number;
}

export interface TradingDecision {
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  entryPrice?: number;
  stopLossPips?: number;
  takeProfitPips?: number;
  lotSize?: number;
  reasoning: string;
  riskRewardRatio?: number;
  setupType?: string;
}

const MAX_DAILY_TRADES = 1000;

/**
 * Rule-based scalping signal engine — no AI required.
 * Entry conditions:
 *
 * ANY SESSION → 2 factors = TRADE  (same as killzone rules in original)
 * KILLZONE (London 07-09, NY 13-14:30 UTC) → 1 factor = TRADE (extra aggressive)
 *
 * Factors:
 *  F1 — EMA stack aligned in trade direction
 *  F2 — RSI 35-65 range AND trending toward trade direction
 *  F3 — MACD histogram expanding in trade direction
 *  F4 — ADX > 18 with correct DI alignment
 *  F5 — Near order block OR bullish/bearish FVG present
 *
 * Hard filters (HOLD regardless):
 *  - Spread > 3 pips
 *  - ADX < 15 (extreme ranging)
 *  - consecutiveLosses >= 4 (circuit breaker — relaxed from 3)
 *  - todayTradeCount >= MAX_DAILY_TRADES
 */
export async function getScalpingSignal(data: MarketData): Promise<TradingDecision> {
  if (data.todayTradeCount >= MAX_DAILY_TRADES) {
    return { action: "HOLD", confidence: 100, reasoning: "Daily limit of 1000 trades reached." };
  }
  if ((data.consecutiveLosses ?? 0) >= 4) {
    return { action: "HOLD", confidence: 100, reasoning: "Circuit breaker: 4 consecutive losses. Pausing." };
  }
  if (data.spread > 3) {
    return { action: "HOLD", confidence: 80, reasoning: `Spread ${data.spread.toFixed(1)} pips too wide — cost kills edge.` };
  }
  if ((data.adx ?? 25) < 15) {
    return { action: "HOLD", confidence: 70, reasoning: `ADX ${(data.adx ?? 0).toFixed(1)} — market ranging, no trend to follow.` };
  }

  const macdHist     = data.macdMain - data.macdSignal;
  const macdHistPrev = data.macdHistPrev ?? macdHist;
  const rsi          = data.rsi;
  const adx          = data.adx ?? 25;
  const plusDI       = data.plusDI ?? 20;
  const minusDI      = data.minusDI ?? 20;

  // ── Factor evaluation for BUY ────────────────────────────────────────────────
  const buyFactors: string[] = [];

  // F1: EMA stack bullish
  if (data.closePrice > data.ema20 && data.ema20 > data.ema50 && data.ema50 > data.ema200) {
    buyFactors.push("EMA_BULL_STACK");
  } else if (data.closePrice > data.ema20 && data.ema20 > data.ema50) {
    buyFactors.push("EMA_PARTIAL_BULL");
  }

  // F2: RSI 35-65 and rising
  if (rsi >= 35 && rsi <= 65 && (data.rsiPrev == null || rsi > data.rsiPrev)) {
    buyFactors.push("RSI_RISING_MID");
  }

  // F3: MACD histogram expanding positive
  if (macdHist > 0 && Math.abs(macdHist) > Math.abs(macdHistPrev)) {
    buyFactors.push("MACD_BULL_EXPAND");
  }

  // F4: ADX trend with bullish DI
  if (adx > 18 && plusDI > minusDI) {
    buyFactors.push("ADX_DI_BULL");
  }

  // F5: Smart money confluence
  if (data.nearOrderBlock || data.fairValueGap === "BULLISH_FVG") {
    buyFactors.push("SMC_BULL_CONFLUENCE");
  }

  // ── Factor evaluation for SELL ───────────────────────────────────────────────
  const sellFactors: string[] = [];

  // F1: EMA stack bearish
  if (data.closePrice < data.ema20 && data.ema20 < data.ema50 && data.ema50 < data.ema200) {
    sellFactors.push("EMA_BEAR_STACK");
  } else if (data.closePrice < data.ema20 && data.ema20 < data.ema50) {
    sellFactors.push("EMA_PARTIAL_BEAR");
  }

  // F2: RSI 35-65 and falling
  if (rsi >= 35 && rsi <= 65 && (data.rsiPrev == null || rsi < data.rsiPrev)) {
    sellFactors.push("RSI_FALLING_MID");
  }

  // F3: MACD histogram expanding negative
  if (macdHist < 0 && Math.abs(macdHist) > Math.abs(macdHistPrev)) {
    sellFactors.push("MACD_BEAR_EXPAND");
  }

  // F4: ADX trend with bearish DI
  if (adx > 18 && minusDI > plusDI) {
    sellFactors.push("ADX_DI_BEAR");
  }

  // F5: Smart money confluence
  if (data.nearOrderBlock || data.fairValueGap === "BEARISH_FVG") {
    sellFactors.push("SMC_BEAR_CONFLUENCE");
  }

  // ── Threshold — always 2; killzone drops to 1 (extra aggressive) ────────────
  const threshold = data.killzone ? 1 : 2;

  const buyScore  = buyFactors.length;
  const sellScore = sellFactors.length;

  // Pick stronger signal if both qualify
  let action: "BUY" | "SELL" | "HOLD" = "HOLD";
  let factors: string[] = [];

  if (buyScore >= threshold && buyScore >= sellScore) {
    action  = "BUY";
    factors = buyFactors;
  } else if (sellScore >= threshold && sellScore > buyScore) {
    action  = "SELL";
    factors = sellFactors;
  }

  if (action === "HOLD") {
    const best = Math.max(buyScore, sellScore);
    return {
      action: "HOLD",
      confidence: 60,
      reasoning: `Only ${best}/${threshold} factors met — conditions insufficient.`,
    };
  }

  // ── Trade parameters ──────────────────────────────────────────────────────────
  const slPips = adx > 35 ? 10 : 12;   // tighter in strong trends
  const tpPips = slPips * 2;            // always 2:1 minimum

  // Confidence: base 60 + 10 per extra factor above threshold + killzone bonus
  const extraFactors = factors.length - threshold;
  const kzBonus      = data.killzone ? 5 : 0;
  const confidence   = Math.min(95, 60 + extraFactors * 10 + kzBonus + (adx > 30 ? 5 : 0));

  // Setup type from dominant factor
  const setupMap: Record<string, string> = {
    EMA_BULL_STACK:       "EMA_PULLBACK",
    EMA_BEAR_STACK:       "EMA_PULLBACK",
    EMA_PARTIAL_BULL:     "EMA_PULLBACK",
    EMA_PARTIAL_BEAR:     "EMA_PULLBACK",
    MACD_BULL_EXPAND:     "MACD_MOMENTUM",
    MACD_BEAR_EXPAND:     "MACD_MOMENTUM",
    ADX_DI_BULL:          "TREND_CONTINUATION",
    ADX_DI_BEAR:          "TREND_CONTINUATION",
    SMC_BULL_CONFLUENCE:  "OB_BOUNCE",
    SMC_BEAR_CONFLUENCE:  "OB_BOUNCE",
    RSI_RISING_MID:       "MOMENTUM",
    RSI_FALLING_MID:      "MOMENTUM",
  };
  const setupType = setupMap[factors[0]] ?? "TREND_CONTINUATION";

  const reasoning = `${factors.slice(0, 3).join(" + ")} | ADX=${adx.toFixed(0)} ${data.session}${data.killzone ? " KILLZONE" : ""}`;

  logger.info(
    { action, confidence, symbol: data.symbol, setup: setupType, factors: factors.length },
    "Rule-based signal"
  );

  return {
    action,
    confidence,
    stopLossPips:   slPips,
    takeProfitPips: tpPips,
    lotSize:        0.01,
    reasoning:      reasoning.slice(0, 180),
    riskRewardRatio: tpPips / slPips,
    setupType,
  };
}
