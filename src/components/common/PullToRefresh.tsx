import React, { useState, useEffect, useRef } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';
import { haptic } from '../../utils/haptics';

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, children }) => {
  const [startY, setStartY] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const THRESHOLD = 80;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0 && !refreshing) {
      setStartY(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (window.scrollY === 0 && startY > 0 && !refreshing) {
      const currentY = e.touches[0].clientY;
      const diff = currentY - startY;
      if (diff > 0) {
        setPullDistance(Math.min(diff * 0.5, 120)); // Resistance
      }
    }
  };

  const handleTouchEnd = async () => {
    if (pullDistance > THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(60); // Snap to loading position
      haptic.medium();
      try {
        await onRefresh();
        haptic.success();
      } finally {
        setTimeout(() => {
          setRefreshing(false);
          setPullDistance(0);
        }, 500);
      }
    } else {
      setPullDistance(0);
    }
    setStartY(0);
  };

  return (
    <div 
      ref={contentRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ minHeight: 'calc(100vh - 100px)' }}
    >
      {/* Loading Indicator */}
      <div 
        className="fixed left-0 right-0 z-10 flex justify-center pointer-events-none transition-all duration-200"
        style={{ 
            top: '60px', 
            transform: `translateY(${pullDistance - 40}px)`,
            opacity: pullDistance > 0 ? 1 : 0
        }}
      >
        <div className="rounded-full p-2 border border-[rgba(255,255,255,0.12)] text-violet-400 bg-[rgba(139,92,246,0.15)]">
            {refreshing ? <Loader2 className="animate-spin" size={20}/> : 
             <ArrowDown size={20} style={{ transform: `rotate(${pullDistance * 2}deg)` }} />
            }
        </div>
      </div>

      {/* Main Content */}
      <div 
        style={{ 
            transform: `translateY(${pullDistance}px)`,
            transition: pulling ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
        }}
        className="will-change-transform"
      >
        {children}
      </div>
    </div>
  );
};

// Helper for 'pulling' state detection during render
let pulling = false;







