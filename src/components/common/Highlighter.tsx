import React from 'react';

interface HighlighterProps {
  text: string;
  highlight: string;
  className?: string;
}

export const Highlighter: React.FC<HighlighterProps> = ({ text, highlight, className = '' }) => {
  if (!highlight || !text) return <span className={className}>{text}</span>;

  const parts = text.toString().split(new RegExp(`(${highlight})`, 'gi'));
  
  return (
    <span className={className}>
      {parts.map((part, i) => 
        part.toLowerCase() === highlight.toLowerCase() ? (
          <span key={i} className="bg-yellow-200 text-slate-900 rounded-sm px-0.5 shadow-sm font-bold">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </span>
  );
};






