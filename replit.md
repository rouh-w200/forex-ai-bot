# SCALP.BOT — Forex Scalping Bot

Bot di scalping Forex professionale con AI Claude che esegue fino a 100 trade/giorno su MT4/MT5. Analizza dati di mercato in tempo reale e decide BUY/SELL/HOLD con gestione del rischio automatica.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — avvia il server API (porta 8080)
- `pnpm --filter @workspace/trading-dashboard run dev` — avvia il dashboard (porta 24210)
- `pnpm run typecheck` — typecheck completo
- `pnpm --filter @workspace/api-spec run codegen` — rigenera hook API e schemi Zod dall'OpenAPI spec
- `pnpm --filter @workspace/db run push` — applica le migrazioni DB

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Claude AI (claude-sonnet-4-6)
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite + Tailwind v4 + Recharts
- MT5 EA: MQL5 Expert Advisor (ScalpingBot_EA.mq5)
- Validation: Zod (zod/v4), drizzle-zod

## Where things live

- `lib/api-spec/openapi.yaml` — contratto API OpenAPI (source of truth)
- `lib/db/src/schema/trades.ts` — tabella trades
- `lib/db/src/schema/bot_signals.ts` — tabella segnali AI
- `artifacts/api-server/src/lib/trading-ai.ts` — logica Claude AI per segnali scalping
- `artifacts/api-server/src/routes/trading/` — route trading (signal, trades, bot status)
- `artifacts/api-server/src/routes/stats/` — route statistiche (daily, overview, history)
- `artifacts/trading-dashboard/` — dashboard React
- `artifacts/trading-dashboard/ScalpingBot_EA.mq5` — Expert Advisor MQL5 per MetaTrader 5

## Architecture decisions

- Claude analizza 15+ indicatori (RSI, MACD, EMA20/50/200, ATR, spread, sessione, trend, volatilità) e risponde in JSON strutturato
- Limite di 100 trade/giorno forzato sia lato API (HTTP 429) che nell'EA
- Risk management: 1% account per trade, SL 10-20 pip, TP minimo 1.5:1 R:R
- L'EA invia dati a POST /api/trading/signal e riceve BUY/SELL/HOLD con confidence score
- Ogni trade è loggato nel DB tramite POST /api/trading/trades per tracking completo
- Dark mode di default — paletta navy/charcoal con verde profitti e rosso perdite

## Product

- **Dashboard Live**: status bot, P&L giornaliero, win rate, trade feed in tempo reale, grafico 30 giorni
- **Trade History**: tabella completa con filtri, entry/exit, pip, confidence, R:R
- **Analytics**: curve P&L, win rate, streak, distribuzione per sessione/simbolo
- **API Signal**: endpoint per MT5 EA che riceve market data e ottiene decisione AI
- **Expert Advisor**: file .mq5 da installare su MetaTrader 5

## User preferences

- Interfaccia dark mode, stile professionale da trader
- Scalping Forex su MT5, fino a 100 trade/giorno
- Claude AI per decisioni di trading
- Lingua italiana per comunicazioni

## Gotchas

- Aggiungere l'URL API alla lista "URL consentite" in MT5: Strumenti > Opzioni > Consulenti Esperti
- Sostituire `YOUR-APP.replit.app` nell'EA con il dominio reale dopo il deploy
- `pnpm run typecheck:libs` va eseguito prima di `typecheck` per buildare le lib composite
- Il Claude model usato è `claude-sonnet-4-6` — non cambiare (claude-opus-4-7 non supporta temperature)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
