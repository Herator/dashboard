import { EVENT_COLORS } from "../lib/eventColors";

export default function ColorSwatchPicker({ value, onChange }) {
  return (
    <div className="color-swatch-picker">
      {EVENT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-swatch${value === color ? " color-swatch--selected" : ""}`}
          style={{ "--swatch-color": color }}
          aria-label={`Color ${color}`}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}
