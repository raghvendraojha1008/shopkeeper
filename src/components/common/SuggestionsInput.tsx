import React, { useState, useRef, useEffect } from 'react';
import { List } from 'lucide-react';

interface SuggestionsInputProps {
  value: string;
  onChange: (e: any) => void;
  placeholder: string;
  list?: any[];
  displayKey?: string;
}

const SuggestionsInput: React.FC<SuggestionsInputProps> = React.memo(({ value, onChange, placeholder, list = [], displayKey = 'name' }) => {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setShow(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
      <div className="relative w-full min-w-0" ref={ref}>
          <div className="flex w-full">
              <input 
                type="text" 
                placeholder={placeholder} 
                className="flex-1 min-w-0 p-3 rounded-l-lg font-bold outline-none focus:ring-2 focus:ring-violet-500/40 text-sm sm:text-base dark-input" 
                value={value} 
                onChange={onChange}
                onFocus={() => setShow(true)} 
              />
              <button type="button" onClick={() => setShow(!show)} className="border-l-0 px-3 rounded-r-lg flex-shrink-0 dark-input text-[rgba(148,163,184,0.45)] hover:text-violet-400">
                <List size={16}/>
              </button>
          </div>
          {show && list.length > 0 && (
              <div className="absolute z-50 left-0 right-0 rounded-xl mt-1 max-h-60 overflow-y-auto border border-[rgba(255,255,255,0.12)]">
                  {list.map((item: any, i: number) => (
                      <div key={i} onClick={() => { 
                          onChange({ target: { value: item[displayKey] } }); 
                          setShow(false); 
                      }} className="p-3 cursor-pointer text-sm border-b last:border-0 border-[rgba(255,255,255,0.06)] hover:bg-[rgba(139,92,246,0.12)] text-[rgba(203,213,225,0.8)]">
                          {item[displayKey]}
                      </div>
                  ))}
              </div>
          )}
      </div>
  );
});

export default SuggestionsInput;






