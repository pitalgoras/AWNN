import React from 'react';
import { useStore } from '../store/useStore';

export const TimeSignatureInput: React.FC = () => {
  const { timeSignature, setTimeSignature } = useStore();
  const [isEditing, setIsEditing] = React.useState(false);
  const [numerator, setNumerator] = React.useState(timeSignature[0].toString());
  const [denominator, setDenominator] = React.useState(timeSignature[1].toString());

  const handleSave = () => {
    const n = parseInt(numerator);
    const d = parseInt(denominator);
    if (!isNaN(n) && !isNaN(d) && n > 0 && d > 0) {
      setTimeSignature([n, d]);
    } else {
      setNumerator(timeSignature[0].toString());
      setDenominator(timeSignature[1].toString());
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 bg-zinc-800 rounded px-1 py-0.5 border border-zinc-700 shadow-lg">
        <input
          type="text"
          value={numerator}
          onChange={(e) => setNumerator(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          className="w-6 bg-transparent text-center text-xs font-bold text-white focus:outline-none"
          autoFocus
        />
        <span className="text-zinc-600 text-[10px]">/</span>
        <input
          type="text"
          value={denominator}
          onChange={(e) => setDenominator(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          className="w-6 bg-transparent text-center text-xs font-bold text-white focus:outline-none"
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className="flex flex-col items-start leading-none hover:bg-zinc-800 px-1.5 py-0.5 rounded transition-colors group"
    >
      <span className="text-[10px] font-bold text-zinc-400 group-hover:text-zinc-200 transition-colors">
        {timeSignature[0]}/{timeSignature[1]}
      </span>
      <span className="text-[7px] font-bold text-zinc-600 uppercase tracking-tighter">SIG</span>
    </button>
  );
};
