import { useState } from 'react';

interface Props {
  text: string;
  start: number;
  end: number;
  disabled?: boolean;
  onChange: (start: number, end: number) => void;
}

/**
 * 行内片段点选：第一次点击定起点，第二次定终点（自动纠正反向选择）。
 * 区间为半开 [start, end)，按字符（码位）计。
 */
export function CharStrip({ text, start, end, disabled, onChange }: Props) {
  const chars = Array.from(text);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const clickChar = (i: number) => {
    if (disabled) return;
    if (anchor === null) {
      setAnchor(i);
      return;
    }
    const s = Math.min(anchor, i);
    const e = Math.max(anchor, i) + 1;
    onChange(s, e);
    setAnchor(null);
  };

  const previewEnd = anchor !== null && hover !== null ? Math.max(anchor, hover) + 1 : null;
  const previewStart = anchor !== null && hover !== null ? Math.min(anchor, hover) : null;

  return (
    <div className={`char-strip${disabled ? ' disabled' : ''}`}>
      {chars.length === 0 && <span className="empty-line">（空行，无法选择片段）</span>}
      {chars.map((c, i) => {
        const selected = i >= start && i < end;
        const previewing =
          previewStart !== null && previewEnd !== null && i >= previewStart && i < previewEnd;
        return (
          <span
            key={i}
            className={
              'char' +
              (selected ? ' selected' : '') +
              (previewing && !selected ? ' preview' : '') +
              (i === anchor ? ' anchor' : '')
            }
            onClick={() => clickChar(i)}
            onMouseEnter={() => setHover(i)}
            title={`位置 ${i}–${i + 1}`}
          >
            {c}
          </span>
        );
      })}
      <span className="range-label">
        区间 [{start}, {end})
      </span>
    </div>
  );
}
