import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // BUY or SELL
  entryPrice: numeric("entry_price", { precision: 10, scale: 5 }).notNull(),
  closePrice: numeric("close_price", { precision: 10, scale: 5 }),
  lotSize: numeric("lot_size", { precision: 8, scale: 2 }).notNull(),
  stopLoss: numeric("stop_loss", { precision: 10, scale: 5 }).notNull(),
  takeProfit: numeric("take_profit", { precision: 10, scale: 5 }).notNull(),
  stopLossPips: numeric("stop_loss_pips", { precision: 8, scale: 1 }),
  takeProfitPips: numeric("take_profit_pips", { precision: 8, scale: 1 }),
  profitLoss: numeric("profit_loss", { precision: 10, scale: 2 }),
  profitLossPips: numeric("profit_loss_pips", { precision: 8, scale: 1 }),
  confidence: numeric("confidence", { precision: 5, scale: 2 }),
  reasoning: text("reasoning"),
  riskRewardRatio: numeric("risk_reward_ratio", { precision: 5, scale: 2 }),
  status: text("status").notNull().default("OPEN"), // OPEN, CLOSED, CANCELLED
  closeReason: text("close_reason"), // TP_HIT, SL_HIT, MANUAL, TRAILING_STOP
  mtTicket: integer("mt_ticket"),
  oandaTradeId: text("oanda_trade_id"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({
  id: true,
  openedAt: true,
  closedAt: true,
});

export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
