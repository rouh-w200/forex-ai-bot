import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botSignalsTable = pgTable("bot_signals", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  action: text("action").notNull(), // BUY, SELL, HOLD
  confidence: numeric("confidence", { precision: 5, scale: 2 }),
  reasoning: text("reasoning"),
  stopLossPips: numeric("stop_loss_pips", { precision: 8, scale: 1 }),
  takeProfitPips: numeric("take_profit_pips", { precision: 8, scale: 1 }),
  lotSize: numeric("lot_size", { precision: 8, scale: 2 }),
  riskRewardRatio: numeric("risk_reward_ratio", { precision: 5, scale: 2 }),
  rsi: numeric("rsi", { precision: 6, scale: 2 }),
  spread: numeric("spread", { precision: 6, scale: 2 }),
  session: text("session"),
  trend: text("trend"),
  volatility: text("volatility"),
  tradeId: integer("trade_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBotSignalSchema = createInsertSchema(botSignalsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertBotSignal = z.infer<typeof insertBotSignalSchema>;
export type BotSignal = typeof botSignalsTable.$inferSelect;
