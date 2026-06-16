import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface CategoryPieChartProps {
  expenses: any[];
}

const COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f97316', // orange
  '#8b5cf6', // purple
  '#ef4444', // red
  '#06b6d4', // cyan
  '#eab308', // yellow
  '#ec4899', // pink
];

const CategoryPieChart: React.FC<CategoryPieChartProps> = ({ expenses }) => {
  const chartData = useMemo(() => {
    const categoryMap: Record<string, number> = {};
    
    expenses.forEach((exp: any) => {
      const category = exp.category || 'Other';
      categoryMap[category] = (categoryMap[category] || 0) + (Number(exp.amount) || 0);
    });

    return Object.entries(categoryMap)
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8); // Top 8 categories
  }, [expenses]);

  const total = chartData.reduce((sum, item) => sum + item.value, 0);

  if (chartData.length === 0) {
    return (
      <div className="p-4 rounded-2xl">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
          Expense Categories
        </h3>
        <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
          No expense data available
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-2xl">
      <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
        Expense Categories
      </h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: 'none',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              formatter={(value: any, name: any) => [
                `₹${Number(value || 0).toLocaleString('en-IN')} (${((Number(value || 0) / total) * 100).toFixed(1)}%)`,
                name
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      
      {/* Legend */}
      <div className="flex flex-wrap gap-2 mt-2">
        {chartData.slice(0, 6).map((item, index) => (
          <div key={item.name} className="flex items-center gap-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            <span className="text-[10px] text-slate-500 font-medium truncate max-w-[60px]">
              {item.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CategoryPieChart;







