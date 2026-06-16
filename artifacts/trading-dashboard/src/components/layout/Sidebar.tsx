import { Link, useLocation } from "wouter";
import { 
  Activity, 
  BarChart3, 
  CandlestickChart,
  History, 
  MonitorDot,
  Zap
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/",       label: "Live Dashboard",   icon: MonitorDot },
  { href: "/chart",  label: "Grafico Mercato",  icon: CandlestickChart },
  { href: "/trades", label: "Trade History",    icon: History },
  { href: "/stats",  label: "Analytics",        icon: BarChart3 },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 border-r border-border bg-card flex flex-col hidden md:flex h-full">
      <div className="h-14 flex items-center px-4 border-b border-border">
        <div className="flex items-center gap-2 text-primary font-bold tracking-wider">
          <Zap className="h-5 w-5 text-warning" />
          <span>SCALP.BOT</span>
        </div>
      </div>
      
      <div className="flex-1 py-4 flex flex-col gap-1 px-2">
        <div className="px-2 mb-2 text-xs font-semibold text-muted-foreground tracking-wider uppercase">
          Command Center
        </div>
        
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href} className="block">
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <item.icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                {item.label}
              </div>
            </Link>
          );
        })}
      </div>
      
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
          <Activity className="h-4 w-4 text-success" />
          <span>MT5 Connected</span>
        </div>
      </div>
    </aside>
  );
}
