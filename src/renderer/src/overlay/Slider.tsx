/**
 * Range slider with a thin track: white fill up to the value, gray after it.
 * Gives the keyboard back to capture mode when released.
 */
export function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange(v: number): void
  className?: string
}) {
  const { label, value, min, max, step = 1, onChange, className } = props
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <input
      type="range"
      className={`slider${className ? ' ' + className : ''}`}
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ '--pct': `${pct}%` } as React.CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={(e) => e.currentTarget.blur()}
    />
  )
}
