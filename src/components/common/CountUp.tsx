import React, { useEffect, useState } from 'react';
import { formatCurrency } from '../../utils/helpers';

interface CountUpProps {
  end: number;
  duration?: number;
  prefix?: string;
  isCurrency?: boolean;
}

export const CountUp: React.FC<CountUpProps> = ({ end, duration = 1000, prefix = '', isCurrency = false }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number | null = null;
    const start = 0;
    
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      
      // Easing function (easeOutExpo)
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      
      setCount(start + (end - start) * ease);

      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };

    window.requestAnimationFrame(step);
  }, [end, duration]);

  const display = isCurrency ? formatCurrency(count) : Math.floor(count);

  return <span className="tabular-nums">{display}</span>;
};






