// Flat geometric weather icon (sun circle / cloud pill / rain drops) built
// from plain divs per the design handoff, rather than emoji or SVG.
export default function WeatherIcon({ shape, large, label }) {
  return (
    <div className={`wicon${large ? " wicon--lg" : ""}`} title={label} aria-label={label} role="img">
      {shape === "sun" && <div className="sun" />}
      {(shape === "cloud" || shape === "cloud-light") && (
        <>
          <div className={`cloud${shape === "cloud-light" ? " cloudlt" : ""}`} />
          <div className={`cloud2${shape === "cloud-light" ? " cloudlt" : ""}`} />
        </>
      )}
      {shape === "rain" && (
        <>
          <div className="cloud" />
          <div className="cloud2" />
          <div className="drop" style={{ left: "5px" }} />
          <div className="drop" style={{ left: "11px" }} />
        </>
      )}
    </div>
  );
}
