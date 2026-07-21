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
              <button type="button" onClick={() => setShow(!show)} className="border-l-0 px-3 rounded-r-lg flex-shrink-0 dark-input text-[var(--text-muted)] hover:text-violet-400">
                <List size={16}/>
              </button>
          </div>
          {show && list.length > 0 && (
              <div className="absolute z-50 left-0 right-0 rounded-xl mt-1 max-h-60 overflow-y-auto border border-[var(--rgba-white-12)]" style={{ background: 'var(--dropdown-bg)', boxShadow: '0 8px 24px var(--rgba-black-18)' }}>
                  {list.map((item: any, i: number) => (
                      <div key={i} onClick={() => { 
                          onChange({ target: { value: item[displayKey] } }); 
                          setShow(false); 
                      }} className="p-3 cursor-pointer text-sm border-b last:border-0 border-[var(--rgba-white-06)] hover:bg-[var(--col-violet-12)] text-[var(--text-secondary)]">
                          {item[displayKey]}
                      </div>
                  ))}
              </div>
          )}
      </div>
  );
});

export default SuggestionsInput;






