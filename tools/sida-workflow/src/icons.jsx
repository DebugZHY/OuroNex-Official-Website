/**
 * Inline 20x20 stroke icons for the SIDA workflow graph.
 * Paths use currentColor, so each card tints its icon with the stage colour.
 */
const PATHS = {
  // Brief / record sheet.
  document: ['M6 3h5.5L15 6.5V17H6z', 'M11.5 3v3.5H15', 'M8.5 10h4', 'M8.5 13h3'],
  // Concept scheme: a page with a layout line and a mark.
  sketch: ['M4.5 4.5h11v11h-11z', 'M4.5 8.5h11', 'M7 12.5l2-2.5 2 2 2.5-2.5'],
  // BIM model cube.
  cube: ['M10 3l6 3v8l-6 3-6-3V6z', 'M4 6l6 3 6-3', 'M10 9v8'],
  // Load takedown: arrows onto a member.
  loads: [
    'M3.5 15.5h13',
    'M6.5 4v8', 'M6.5 12l-1.6-1.8', 'M6.5 12l1.6-1.8',
    'M10 4v8', 'M10 12l-1.6-1.8', 'M10 12l1.6-1.8',
    'M13.5 4v8', 'M13.5 12l-1.6-1.8', 'M13.5 12l1.6-1.8',
  ],
  // Global analysis: response curve on axes.
  wave: ['M3 13.5c2.6 0 3.4-7 6-7s3.4 7 6 7h2', 'M3 16.5h14', 'M3 3.5v13'],
  // Beam with simple supports.
  beam: ['M3 9h14v3H3z', 'M5.5 12v4', 'M14.5 12v4', 'M4.5 16h2', 'M13.5 16h2'],
  // Column.
  column: ['M7.5 3h5v13h-5z', 'M5 16.5h10', 'M6.5 3h7'],
  // Wind.
  wind: ['M3 7.5h7.5a2.5 2.5 0 1 0-2.5-2.5', 'M3 12h11a2.5 2.5 0 1 1-2.5 2.5'],
  // Braced frame / lateral system.
  brace: ['M4.5 4v12', 'M15.5 4v12', 'M4.5 4h11', 'M4.5 16h11', 'M4.5 15.5L15.5 4.5'],
  // Foundation piles.
  pile: ['M3 11.5h14', 'M6 11.5v5.5', 'M10 11.5v5.5', 'M14 11.5v5.5', 'M3 8.5h14'],
  // Pile capacity check.
  pilecheck: ['M3.5 9.5h13', 'M6.5 9.5v4', 'M10 9.5v4', 'M13.5 9.5v4', 'M4 16.5h12', 'M6.5 5.5l1.6 1.7 3-3.3'],
  // Detailing grid.
  grid: ['M4 4h12v12H4z', 'M4 8h12', 'M4 12h12', 'M8 4v12', 'M12 4v12'],
  // Concrete check.
  checkbox: ['M4 4h12v12H4z', 'M7 10.2l2.2 2.3L13.2 8'],
  // Steel check: I-section with a tick.
  ibeam: ['M6.5 3.5h7', 'M6.5 16.5h7', 'M10 3.5v13', 'M12.5 8.5l1.5 1.5-1.5 1.5', 'M3.5 8.5l1.5 1.5-1.5 1.5'],
  // Fire.
  fire: [
    'M10 3c3 3.6 4 5.4 4 7.8a4 4 0 0 1-8 0c0-1.5.6-2.6 1.7-4 .4 1 .9 1.6 1.5 1.8.5-2.2 0-4 .8-5.6z',
    'M10 17v.5',
  ],
  // Wind check.
  windcheck: ['M3 7h7a2 2 0 1 0-2-2', 'M3 11.5h6.5', 'M11 14.5l2 2 4-4.5'],
  // Compliance shield.
  shield: ['M10 3l6 2.2v4.6c0 3.9-2.8 6.2-6 7.2-3.2-1-6-3.3-6-7.2V5.2z', 'M7.5 10.2l1.8 1.9 3.2-3.6'],
  // Drawing sheet.
  sheet: ['M5 3h7l3.5 3.5V17H5z', 'M12 3v4h3.5', 'M7.5 11.5h5', 'M7.5 14h3.5'],
  // Authority submission stamp.
  stamp: ['M6.5 17h7', 'M7.5 17v-2.2h5V17', 'M8 14.8V9.2a2 2 0 1 1 4 0v5.6', 'M5.5 6.2h9'],
  // Approval stamp with a tick.
  stampcheck: ['M6 12.5h8v3H6z', 'M7.8 12.5V8.6a2.2 2.2 0 1 1 4.4 0v3.9', 'M13 5.6l1.6 1.7L17 4.6'],
  // Crane / construction support.
  crane: ['M4 17.5h13', 'M6 17.5V4h10', 'M6 7.5h6', 'M12 7.5v4', 'M10 11.5h4v3.2h-4z'],
  // Site inspection clipboard.
  clipboard: ['M7.5 4.5h5V6h-5z', 'M5.5 5.5h9V17h-9z', 'M8 10.5l1.6 1.6L13 8.7'],
};

export function StageIcon({ name }) {
  const segments = PATHS[name] || PATHS.document;
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {segments.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}
