import { Card } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
}

export function StatsCard({ title, value, icon: Icon, trend, trendUp }: StatsCardProps) {
  return (
    <Card className="p-6 bg-white/5 border-white/10 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-400">{title}</p>
          <p className="text-3xl font-bold text-white mt-2">{value}</p>
        </div>
        <div className="h-12 w-12 rounded-xl bg-violet-500/10 flex items-center justify-center">
          <Icon className="h-6 w-6 text-violet-400" />
        </div>
      </div>
      {trend && (
        <div className="mt-4 flex items-center text-sm">
          <span className={trendUp ? 'text-emerald-400' : 'text-rose-400'}>
            {trend}
          </span>
          <span className="text-slate-500 ml-2">from last month</span>
        </div>
      )}
    </Card>
  );
}
