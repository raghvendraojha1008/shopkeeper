import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface ChartData {
  date: string;
  sales: number;
  expenses: number;
}

interface SalesChartProps {
  ledger: any[];
  expenses: any[];
  days?: number;
}

const SalesChart: React.FC<SalesChartProps> = ({ ledger, expenses, days = 30 }) => {
  const chartData = useMemo(() => {
    const now = new Date();
    const data: ChartData[] = [];

    // Generate last N days
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      // Calculate sales for this day
      const daySales = ledger
        .filter((l: any) => l.date === dateStr && l.type === 'sell')
        .reduce((sum: number, l: any) => {
          const rent = Number(l.vehicle_rent) || 0;
          const total = Number(l.total_amount) || 0;
          return sum + (total - rent);
        }, 0);

      // Calculate expenses for this day
      const dayExpenses = expenses
        .filter((e: any) => e.date === dateStr)
        .reduce((sum: number, e: any) => sum + (Number(e.amount) || 0), 0);

      data.push({
        date: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        sales: Math.round(daySales),
        expenses: Math.round(dayExpenses),
      });
    }

    return data;
  }, [ledger, expenses, days]);

  const formatValue = (value: number) => {
    if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
    if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
    return `₹${value}`;
  };

  return (
    <div className="p-4 rounded-2xl">
      <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
        Sales vs Expenses Trend
      </h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--rgba-white-07)" />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 10, fill: "var(--col-slate)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--col-slate-200)" }}
              interval="preserveStartEnd"
            />
            <YAxis 
              tick={{ fontSize: 10, fill: "var(--col-slate)" }}
              tickFormatter={formatValue}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--col-surface-dark2)",
                border: 'none',
                borderRadius: '8px',
                fontSize: 'var(--font-size-chart-sm)',
              }}
              labelStyle={{ color: "var(--col-slate)" }}
              formatter={(value: any, name: any) => [
                `₹${Number(value || 0).toLocaleString('en-IN')}`,
                name === 'sales' ? 'Sales' : 'Expenses'
              ]}
            />
            <Legend 
              wrapperStyle={{ fontSize: 'var(--font-size-chart-xs)' }}
              formatter={(value) => value === 'sales' ? 'Sales' : 'Expenses'}
            />
            <Line
              type="monotone"
              dataKey="sales"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "var(--col-green-500)" }}
            />
            <Line
              type="monotone"
              dataKey="expenses"
              stroke="var(--col-orange)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "var(--col-orange)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SalesChart;







