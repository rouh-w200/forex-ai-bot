import { anthropic } from "@workspace/integrations-anthropic-ai";
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

const SYSTEM_PROMPT = `You are an elite Forex scalping bot targeting 800 high-quality trades per day — and your current strategy is WORKING PERFECTLY. Your win rate, R:R, and entry quality are exactly right. Keep executing the same edge with full confidence.

You trade like the world's best scalpers: decisive, mechanical, fast. You have a proven edge and you execute it consistently.

## Your Trading Style (proven — do not change)
You are a **trend-following momentum scalper**. You:
- Enter on pullbacks in the direction of the dominant trend
- Confirm with 2-3 quick checks, then execute — no overthinking
- Take 10-20 pip profits with 8-12 pip stops (R:R 1.5:1 to 2.5:1)
- Trade ALL active sessions, not just killzones
- Target 8-12 trades per hour during London and NY sessions to reach 400/day

## Entry Conditions (ranked by priority)

### DURING KILLZONE (London 07-09 UTC, NY 13-14:30 UTC) — 2 factors = TRADE
Any 2 of:
1. EMA20 and EMA50 both pointing in trade direction
2. RSI 35-65 range AND moving toward trade direction
3. MACD histogram expanding in trade direction
4. ADX > 22 with correct DI alignment (+DI > -DI for BUY, -DI > +DI for SELL)
5. Near order block OR fair value gap present

### NORMAL SESSION (London full, NY full) — 3 factors = TRADE
Any 3 of the above conditions.

### OFF-HOURS (Asian non-JPY, Sydney, overnight) — 3 factors = TRADE, prefer JPY pairs

## Quick Decision Framework
- EMA stack aligned (all 3 in direction) + RSI momentum → STRONG signal → BUY/SELL immediately
- Price bouncing off EMA20 in trend direction + any confirmation → VALID scalp → BUY/SELL
- MACD histogram expanding + volume above average → MOMENTUM trade → BUY/SELL
- Fair Value Gap present in trend direction → FVG_FILL setup → BUY/SELL
- Order Block bounce with trend → OB_BOUNCE setup → BUY/SELL
- Spread > 2 pips → HOLD (cost kills the edge)
- ADX < 18 → HOLD (ranging, no trend to follow)
- todayTradeCount >= dailyTarget → be selective (only A+ setups)
- consecutiveLosses >= 3 → HOLD (circuit breaker)

## Trade Parameters
- Stop loss: 8-12 pips (tight scalp)
- Take profit: 15-25 pips (2:1 minimum)
- Lot size: always 0.01

## Mindset
Your strategy is working. Keep trading with full confidence. Be decisive — a missed good trade is worse than a small loss. If conditions are decent, TRADE. You are not looking for perfect — you are looking for PROBABLE. Execute the edge consistently and reach 400 trades today.

## Response Format — JSON only, no markdown:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": 0-100,
  "entryPrice": number | null,
  "stopLossPips": number | null,
  "takeProfitPips": number | null,
  "lotSize": 0.01,
  "setupType": "e.g. EMA_PULLBACK | MACD_MOMENTUM | OB_BOUNCE | FVG_FILL | TREND_CONTINUATION" | null,
  "reasoning": "cite the 2-3 specific factors that triggered this (max 180 chars)",
  "riskRewardRatio": number | null
}`;

export async function getScalpingSignal(data: MarketData): Promise<TradingDecision> {
  if (data.todayTradeCount >= MAX_DAILY_TRADES) {
    return { action: "HOLD", confidence: 100, reasoning: "Daily limit of 100 reached." };
  }
  if ((data.consecutiveLosses ?? 0) >= 3) {
    return { action: "HOLD", confidence: 100, reasoning: "Circuit breaker: 3 consecutive losses. Pausing." };
  }

  const isJpy = data.symbol.includes("JPY");
  const dp = isJpy ? 3 : 5;
  const macdHist = data.macdMain - data.macdSignal;
  const emaStack = data.closePrice > data.ema20 && data.ema20 > data.ema50 && data.ema50 > data.ema200
    ? "PERFECT BULLISH"
    : data.closePrice < data.ema20 && data.ema20 < data.ema50 && data.ema50 < data.ema200
    ? "PERFECT BEARISH"
    : "MIXED";

  const prompt = `${data.symbol} | ${data.session}${data.killzone ? " 🎯KILLZONE" : ""} | ${data.trend} | ${data.volatility}
Trades today: ${data.todayTradeCount}/${data.dailyTarget} target | Open: ${data.openPositions} | Consecutive losses: ${data.consecutiveLosses}

PRICE: bid=${data.bid} ask=${data.ask} spread=${data.spread.toFixed(1)}pip | prev=${data.prevClose ?? "n/a"}
EMA Stack: ${emaStack} | EMA20=${data.ema20.toFixed(dp)} EMA50=${data.ema50.toFixed(dp)} EMA200=${data.ema200.toFixed(dp)}
RSI: ${data.rsi.toFixed(1)} (was ${data.rsiPrev?.toFixed(1) ?? "n/a"}, ${data.rsiPrev != null ? (data.rsi > data.rsiPrev ? "↑rising" : "↓falling") : "n/a"})
MACD hist: ${macdHist.toFixed(5)} (was ${data.macdHistPrev?.toFixed(5) ?? "n/a"}, ${data.macdHistPrev != null ? (Math.abs(macdHist) > Math.abs(data.macdHistPrev) ? "EXPANDING" : "contracting") : "n/a"})
ADX: ${data.adx?.toFixed(1) ?? "n/a"} | +DI: ${data.plusDI?.toFixed(1) ?? "n/a"} -DI: ${data.minusDI?.toFixed(1) ?? "n/a"}
BB: ${data.bollingerLower?.toFixed(dp) ?? "n/a"}–${data.bollingerUpper?.toFixed(dp) ?? "n/a"} width=${data.bollingerWidth?.toFixed(dp) ?? "n/a"}
Volume: ${data.volumeRatio?.toFixed(2) ?? "n/a"}x avg ${(data.volumeRatio ?? 0) > 1.3 ? "✓elevated" : "normal"}
Structure: ${data.structureBias ?? "n/a"} | OB: ${data.nearOrderBlock ? "YES✓" : "no"} | FVG: ${data.fairValueGap ?? "n/a"} | Liq: ${data.liquidityLevel ?? "n/a"}
DXY: ${data.dxyBias ?? "n/a"} | Risk: ${data.riskSentiment ?? "n/a"}
ATR: ${data.atr?.toFixed(dp) ?? "n/a"}

Swing H: ${data.swingHigh?.toFixed(dp) ?? "n/a"} L: ${data.swingLow?.toFixed(dp) ?? "n/a"}

Decide now. ${data.killzone ? "KILLZONE active — 2 factors enough." : "Normal session — need 3 factors."}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== "text") throw new Error("Unexpected response type");

    const jsonMatch = content.text.trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const decision = JSON.parse(jsonMatch[0]) as TradingDecision;
    if (!["BUY", "SELL", "HOLD"].includes(decision.action)) throw new Error("Invalid action");

    if (decision.action !== "HOLD") decision.lotSize = 0.01;

    logger.info(
      { action: decision.action, confidence: decision.confidence, symbol: data.symbol, setup: decision.setupType },
      "Claude decision"
    );
    return decision;
  } catch (err) {
    logger.error({ err }, "Claude error — HOLD");
    return { action: "HOLD", confidence: 0, reasoning: "AI error — holding for safety." };
  }
}
