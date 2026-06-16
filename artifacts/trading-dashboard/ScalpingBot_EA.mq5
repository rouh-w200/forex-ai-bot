//+------------------------------------------------------------------+
//|                           ScalpingBot_EA.mq5                     |
//|          Forex Scalping Bot — Claude AI Signal Integration        |
//|  Connette MetaTrader 5 all'API server per segnali AI in tempo    |
//|  reale. Esegue fino a 100 scalp/giorno con gestione rischio      |
//|  professionale.                                                   |
//+------------------------------------------------------------------+
#property copyright "Forex Scalping Bot"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- Input parameters
input string   ApiUrl             = "https://workspaceapi-server-production-a3ab.up.railway.app/api";  // URL API server (senza slash finale)
input string   TradingSymbol      = "EURUSD";    // Simbolo da tradare
input string   Timeframe          = "M1";        // Timeframe (M1, M5, M15)
input int      SignalIntervalSec  = 30;          // Secondi tra ogni richiesta di segnale
input double   MaxSpreadPips      = 3.0;         // Spread massimo accettabile in pips
input int      MagicNumber        = 20240518;    // Magic number EA
input bool     EnableTrading      = true;        // Abilita esecuzione ordini
input bool     EnableLogging      = true;        // Abilita log dettagliato

//--- Internal state
CTrade         trade;
CPositionInfo  posInfo;
datetime       lastSignalTime     = 0;
int            rsiHandle          = INVALID_HANDLE;
int            macdHandle         = INVALID_HANDLE;
int            ema20Handle        = INVALID_HANDLE;
int            ema50Handle        = INVALID_HANDLE;
int            ema200Handle       = INVALID_HANDLE;
int            atrHandle          = INVALID_HANDLE;

//+------------------------------------------------------------------+
//| Expert initialization                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(20);
   
   // Initialize indicators
   rsiHandle   = iRSI(TradingSymbol, PERIOD_M1, 14, PRICE_CLOSE);
   macdHandle  = iMACD(TradingSymbol, PERIOD_M1, 12, 26, 9, PRICE_CLOSE);
   ema20Handle = iMA(TradingSymbol, PERIOD_M1, 20, 0, MODE_EMA, PRICE_CLOSE);
   ema50Handle = iMA(TradingSymbol, PERIOD_M1, 50, 0, MODE_EMA, PRICE_CLOSE);
   ema200Handle= iMA(TradingSymbol, PERIOD_M1, 200, 0, MODE_EMA, PRICE_CLOSE);
   atrHandle   = iATR(TradingSymbol, PERIOD_M1, 14);
   
   if (rsiHandle == INVALID_HANDLE || macdHandle == INVALID_HANDLE)
   {
      Print("ERRORE: Impossibile inizializzare gli indicatori.");
      return INIT_FAILED;
   }
   
   Print("ScalpingBot EA inizializzato. API: ", ApiUrl);
   Print("Simbolo: ", TradingSymbol, " | Trading abilitato: ", EnableTrading);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                           |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   IndicatorRelease(rsiHandle);
   IndicatorRelease(macdHandle);
   IndicatorRelease(ema20Handle);
   IndicatorRelease(ema50Handle);
   IndicatorRelease(ema200Handle);
   IndicatorRelease(atrHandle);
   Print("ScalpingBot EA fermato. Reason: ", reason);
}

//+------------------------------------------------------------------+
//| Expert tick                                                       |
//+------------------------------------------------------------------+
void OnTick()
{
   datetime now = TimeCurrent();
   
   // Throttle signal requests
   if (now - lastSignalTime < SignalIntervalSec)
      return;
      
   // Check spread
   double spread = GetSpreadPips();
   if (spread > MaxSpreadPips)
   {
      if (EnableLogging) Print("Spread troppo alto: ", DoubleToString(spread, 1), " pips. Skip.");
      return;
   }
   
   lastSignalTime = now;
   
   // Collect market data
   string marketJson = BuildMarketDataJson();
   if (marketJson == "")
      return;
   
   // Request AI signal
   string signalJson = HttpPost(ApiUrl + "/trading/signal", marketJson);
   if (signalJson == "")
      return;
   
   // Parse signal
   string action     = ExtractJsonString(signalJson, "action");
   double confidence = ExtractJsonDouble(signalJson, "confidence");
   double slPips     = ExtractJsonDouble(signalJson, "stopLossPips");
   double tpPips     = ExtractJsonDouble(signalJson, "takeProfitPips");
   double lotSize    = ExtractJsonDouble(signalJson, "lotSize");
   string reasoning  = ExtractJsonString(signalJson, "reasoning");
   bool   limitReach = ExtractJsonBool(signalJson, "maxDailyTradesReached");
   
   if (EnableLogging)
      Print("Segnale AI: ", action, " | Confidence: ", DoubleToString(confidence, 1),
            "% | SL: ", DoubleToString(slPips, 1), " | TP: ", DoubleToString(tpPips, 1),
            " | Lot: ", DoubleToString(lotSize, 2));
   
   if (limitReach)
   {
      Print("Limite giornaliero raggiunto. Nessun nuovo trade.");
      return;
   }
   
   if (!EnableTrading)
      return;
   
   // Execute trade
   if (action == "BUY" && confidence >= 60 && slPips > 0 && tpPips > 0)
   {
      ExecuteBuy(slPips, tpPips, lotSize, reasoning);
   }
   else if (action == "SELL" && confidence >= 60 && slPips > 0 && tpPips > 0)
   {
      ExecuteSell(slPips, tpPips, lotSize, reasoning);
   }
   
   // Sync open positions
   SyncOpenPositions();
}

//+------------------------------------------------------------------+
//| Execute BUY order                                                 |
//+------------------------------------------------------------------+
void ExecuteBuy(double slPips, double tpPips, double lots, string reasoning)
{
   double ask    = SymbolInfoDouble(TradingSymbol, SYMBOL_ASK);
   double pip    = GetPipSize();
   double sl     = ask - slPips * pip;
   double tp     = ask + tpPips * pip;
   double rr     = tpPips / slPips;
   
   if (lots <= 0) lots = 0.01;
   
   Print("Esecuzione BUY ", TradingSymbol, " | Ask:", DoubleToString(ask, 5),
         " | SL:", DoubleToString(sl, 5), " | TP:", DoubleToString(tp, 5),
         " | Lot:", DoubleToString(lots, 2));
   
   if (trade.Buy(lots, TradingSymbol, ask, sl, tp, "ScalpBot|" + reasoning))
   {
      ulong ticket = trade.ResultOrder();
      LogTradeOpen(ticket, "BUY", ask, lots, sl, tp, slPips, tpPips, rr, reasoning);
   }
   else
   {
      Print("ERRORE BUY: ", trade.ResultRetcodeDescription());
   }
}

//+------------------------------------------------------------------+
//| Execute SELL order                                                |
//+------------------------------------------------------------------+
void ExecuteSell(double slPips, double tpPips, double lots, string reasoning)
{
   double bid    = SymbolInfoDouble(TradingSymbol, SYMBOL_BID);
   double pip    = GetPipSize();
   double sl     = bid + slPips * pip;
   double tp     = bid - tpPips * pip;
   double rr     = tpPips / slPips;
   
   if (lots <= 0) lots = 0.01;
   
   Print("Esecuzione SELL ", TradingSymbol, " | Bid:", DoubleToString(bid, 5),
         " | SL:", DoubleToString(sl, 5), " | TP:", DoubleToString(tp, 5),
         " | Lot:", DoubleToString(lots, 2));
   
   if (trade.Sell(lots, TradingSymbol, bid, sl, tp, "ScalpBot|" + reasoning))
   {
      ulong ticket = trade.ResultOrder();
      LogTradeOpen(ticket, "SELL", bid, lots, sl, tp, slPips, tpPips, rr, reasoning);
   }
   else
   {
      Print("ERRORE SELL: ", trade.ResultRetcodeDescription());
   }
}

//+------------------------------------------------------------------+
//| Sync open positions                                              |
//+------------------------------------------------------------------+
void SyncOpenPositions()
{
   for (int i = 0; i < PositionsTotal(); i++)
   {
      if (!posInfo.SelectByIndex(i)) continue;
      if (posInfo.Magic() != MagicNumber) continue;
      
      // Check if position was closed and log it
      // (Full position monitoring would require a separate thread/timer)
   }
}

//+------------------------------------------------------------------+
//| Log opened trade to API                                          |
//+------------------------------------------------------------------+
void LogTradeOpen(ulong ticket, string direction, double entryPrice,
                  double lots, double sl, double tp,
                  double slPips, double tpPips, double rr, string reasoning)
{
   string body = StringFormat(
      "{\"symbol\":\"%s\",\"direction\":\"%s\",\"entryPrice\":%.5f,"
      "\"lotSize\":%.2f,\"stopLoss\":%.5f,\"takeProfit\":%.5f,"
      "\"stopLossPips\":%.1f,\"takeProfitPips\":%.1f,"
      "\"riskRewardRatio\":%.2f,\"reasoning\":\"%s\",\"mtTicket\":%I64u}",
      TradingSymbol, direction, entryPrice,
      lots, sl, tp, slPips, tpPips, rr,
      EscapeJson(reasoning), ticket
   );
   
   string result = HttpPost(ApiUrl + "/trading/trades", body);
   if (EnableLogging) Print("Trade loggato: ", result == "" ? "ERRORE" : "OK");
}

//+------------------------------------------------------------------+
//| Build market data JSON payload                                   |
//+------------------------------------------------------------------+
string BuildMarketDataJson()
{
   double rsiArr[3], macdMain[3], macdSig[3], macdHist[3];
   double ema20[3], ema50[3], ema200[3], atrArr[3];
   double high[3], low[3], close[3], volume[3];
   
   if (CopyBuffer(rsiHandle,    0, 0, 3, rsiArr)    < 0) return "";
   if (CopyBuffer(macdHandle,   0, 0, 3, macdMain)  < 0) return "";
   if (CopyBuffer(macdHandle,   1, 0, 3, macdSig)   < 0) return "";
   if (CopyBuffer(macdHandle,   2, 0, 3, macdHist)  < 0) return "";
   if (CopyBuffer(ema20Handle,  0, 0, 3, ema20)     < 0) return "";
   if (CopyBuffer(ema50Handle,  0, 0, 3, ema50)     < 0) return "";
   if (CopyBuffer(ema200Handle, 0, 0, 3, ema200)    < 0) return "";
   if (CopyBuffer(atrHandle,    0, 0, 3, atrArr)    < 0) return "";
   
   CopyHigh(TradingSymbol, PERIOD_M1, 0, 3, high);
   CopyLow(TradingSymbol, PERIOD_M1, 0, 3, low);
   CopyClose(TradingSymbol, PERIOD_M1, 0, 3, close);
   CopyTickVolume(TradingSymbol, PERIOD_M1, 0, 3, (long&)volume);
   
   double bid = SymbolInfoDouble(TradingSymbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(TradingSymbol, SYMBOL_ASK);
   double spreadPips = GetSpreadPips();
   
   string session    = GetCurrentSession();
   string trend      = GetTrend(ema20[0], ema50[0], ema200[0], close[0]);
   string volatility = GetVolatility(atrArr[0]);
   
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   int    openPos = PositionsTotal();
   
   // Count today's trades via EA comment tracking (approximate)
   int todayCount = CountTodayTrades();
   
   return StringFormat(
      "{\"symbol\":\"%s\",\"timeframe\":\"%s\","
      "\"bid\":%.5f,\"ask\":%.5f,\"spread\":%.2f,"
      "\"atr\":%.5f,\"rsi\":%.2f,"
      "\"macdMain\":%.5f,\"macdSignal\":%.5f,\"macdHistogram\":%.5f,"
      "\"ema20\":%.5f,\"ema50\":%.5f,\"ema200\":%.5f,"
      "\"highPrice\":%.5f,\"lowPrice\":%.5f,\"closePrice\":%.5f,"
      "\"volume\":%.0f,\"session\":\"%s\",\"trend\":\"%s\","
      "\"volatility\":\"%s\",\"accountBalance\":%.2f,\"accountEquity\":%.2f,"
      "\"openPositions\":%d,\"todayTradeCount\":%d}",
      TradingSymbol, Timeframe,
      bid, ask, spreadPips,
      atrArr[0], rsiArr[0],
      macdMain[0], macdSig[0], macdHist[0],
      ema20[0], ema50[0], ema200[0],
      high[0], low[0], close[1],
      volume[0], session, trend,
      volatility, balance, equity,
      openPos, todayCount
   );
}

//+------------------------------------------------------------------+
//| Determine current trading session                                |
//+------------------------------------------------------------------+
string GetCurrentSession()
{
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   
   // London: 07:00-16:00 GMT | NY: 12:00-21:00 GMT
   bool london = (h >= 7 && h < 16);
   bool ny     = (h >= 12 && h < 21);
   bool tokyo  = (h >= 0 && h < 9);
   
   if (london && ny) return "OVERLAP";
   if (london)       return "LONDON";
   if (ny)           return "NEW_YORK";
   if (tokyo)        return "TOKYO";
   return "OFF";
}

//+------------------------------------------------------------------+
//| Determine trend from EMAs                                        |
//+------------------------------------------------------------------+
string GetTrend(double ema20val, double ema50val, double ema200val, double price)
{
   if (price > ema20val && ema20val > ema50val && ema50val > ema200val) return "BULLISH";
   if (price < ema20val && ema20val < ema50val && ema50val < ema200val) return "BEARISH";
   return "SIDEWAYS";
}

//+------------------------------------------------------------------+
//| Determine volatility from ATR                                    |
//+------------------------------------------------------------------+
string GetVolatility(double atrVal)
{
   double pip = GetPipSize();
   double atrPips = atrVal / pip;
   
   if (atrPips < 5)  return "LOW";
   if (atrPips > 20) return "HIGH";
   return "NORMAL";
}

//+------------------------------------------------------------------+
//| Get pip size for current symbol                                  |
//+------------------------------------------------------------------+
double GetPipSize()
{
   double point = SymbolInfoDouble(TradingSymbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(TradingSymbol, SYMBOL_DIGITS);
   return (digits == 3 || digits == 5) ? point * 10 : point;
}

//+------------------------------------------------------------------+
//| Get current spread in pips                                       |
//+------------------------------------------------------------------+
double GetSpreadPips()
{
   double ask = SymbolInfoDouble(TradingSymbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(TradingSymbol, SYMBOL_BID);
   return (ask - bid) / GetPipSize();
}

//+------------------------------------------------------------------+
//| Count approximate today's trades from history                   |
//+------------------------------------------------------------------+
int CountTodayTrades()
{
   datetime dayStart = StringToTime(TimeToString(TimeLocal(), TIME_DATE));
   int total = 0;
   
   if (!HistorySelect(dayStart, TimeCurrent())) return 0;
   
   for (int i = 0; i < HistoryDealsTotal(); i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if (ticket == 0) continue;
      if (HistoryDealGetInteger(ticket, DEAL_MAGIC) != MagicNumber) continue;
      if (HistoryDealGetInteger(ticket, DEAL_ENTRY) == DEAL_ENTRY_IN) total++;
   }
   return total;
}

//+------------------------------------------------------------------+
//| HTTP POST using WinInet                                          |
//+------------------------------------------------------------------+
string HttpPost(string url, string body)
{
   char   post[];
   char   result[];
   string headers = "Content-Type: application/json\r\n";
   string resultHeaders;
   int    timeout = 5000;
   
   StringToCharArray(body, post, 0, StringLen(body));
   
   int res = WebRequest("POST", url, headers, timeout, post, result, resultHeaders);
   
   if (res == -1)
   {
      int err = GetLastError();
      if (EnableLogging) Print("WebRequest ERRORE ", err, " — URL: ", url);
      if (err == 4014)
         Print("Aggiungi '", url, "' alla lista URL consentite in: Strumenti > Opzioni > Consulenti Esperti");
      return "";
   }
   
   return CharArrayToString(result);
}

//+------------------------------------------------------------------+
//| Extract string value from simple JSON                           |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key)
{
   string search = "\"" + key + "\":\"";
   int start = StringFind(json, search);
   if (start < 0) return "";
   start += StringLen(search);
   int end = StringFind(json, "\"", start);
   if (end < 0) return "";
   return StringSubstr(json, start, end - start);
}

//+------------------------------------------------------------------+
//| Extract double value from simple JSON                           |
//+------------------------------------------------------------------+
double ExtractJsonDouble(string json, string key)
{
   string search = "\"" + key + "\":";
   int start = StringFind(json, search);
   if (start < 0) return 0.0;
   start += StringLen(search);
   // Skip whitespace
   while (start < StringLen(json) && StringGetCharacter(json, start) == ' ') start++;
   // Find end of number
   int end = start;
   while (end < StringLen(json))
   {
      ushort c = StringGetCharacter(json, end);
      if (c != '-' && c != '.' && (c < '0' || c > '9')) break;
      end++;
   }
   if (end == start) return 0.0;
   return StringToDouble(StringSubstr(json, start, end - start));
}

//+------------------------------------------------------------------+
//| Extract boolean value from simple JSON                          |
//+------------------------------------------------------------------+
bool ExtractJsonBool(string json, string key)
{
   string search = "\"" + key + "\":";
   int start = StringFind(json, search);
   if (start < 0) return false;
   start += StringLen(search);
   while (start < StringLen(json) && StringGetCharacter(json, start) == ' ') start++;
   return StringSubstr(json, start, 4) == "true";
}

//+------------------------------------------------------------------+
//| Escape special characters for JSON string                       |
//+------------------------------------------------------------------+
string EscapeJson(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\n", "\\n");
   StringReplace(s, "\r", "\\r");
   return s;
}
//+------------------------------------------------------------------+
