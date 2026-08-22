const BULB_POSITIONS = [6, 14, 22, 30, 38, 46, 54, 62, 70, 78, 86, 94];

export function FestivalStringLights() {
  return (
    <div className="festival-string-lights" aria-hidden>
      {BULB_POSITIONS.map((left) => (
        <span key={left} style={{ left: `${left}%` }} />
      ))}
    </div>
  );
}
