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
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
              interval="preserveStartEnd"
            />
            <YAxis 
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickFormatter={formatValue}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: 'none',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(value: any, name: any) => [
                `₹${Number(value || 0).toLocaleString('en-IN')}`,
                name === 'sales' ? 'Sales' : 'Expenses'
              ]}
            />
            <Legend 
              wrapperStyle={{ fontSize: '10px' }}
              formatter={(value) => value === 'sales' ? 'Sales' : 'Expenses'}
            />
            <Line
              type="monotone"
              dataKey="sales"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#22c55e' }}
            />
            <Line
              type="monotone"
              dataKey="expenses"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#f97316' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SalesChart;







