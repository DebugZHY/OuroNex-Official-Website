/* Copyright (C) 2026 OuroNex Technology Company Limited. All rights reserved.
 * Section glyph vocabulary from SODA web/js/ui/section-visuals.js:
 * getSectionTypeIconSvg / getGeneralSectionIconSvg. These paths intentionally
 * match the original 32 × 32 icons, including used (solid) / unused (outline).
 * Input is the actual stored sectionGeometry.sectionType, never a section name.
 * SVG markup below is entirely static; no metadata text is inserted into it.
 */

const TYPE_LABELS = Object.freeze({
  0: 'General (Basic)', 1: 'General (Advanced)', 2: 'I/H', 3: 'I/H',
  4: 'Channel', 5: 'T section', 6: 'Rectangular hollow section', 7: 'Angle',
  8: 'Circular hollow section', 9: 'Circular solid section', 10: 'Rectangular solid section',
  11: 'Z section', 12: 'Mono I/H', 13: 'Arbitrary section',
  14: 'Cross plate', 15: 'Double angle', 16: 'I-box',
});

export function getSectionTypeLabel(sectionType) {
  return Number.isInteger(sectionType) && TYPE_LABELS[sectionType]
    ? TYPE_LABELS[sectionType] : 'Section type unavailable';
}

function generalIcon(advanced) {
  const frame = '<rect x="7" y="7" width="18" height="18" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="2.2"/>';
  const body = advanced
    ? '<path d="M10 22L22 10M10 16h12M16 10v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>' +
      '<circle cx="10" cy="22" r="1.7" fill="currentColor"/>' +
      '<circle cx="22" cy="10" r="1.7" fill="currentColor"/>'
    : '<path d="M11 16h10M16 11v10" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/>';
  return '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">' + frame + body + '</svg>';
}

export function getSectionGlyphSvg(sectionType, used = false) {
  if (!Number.isInteger(sectionType)) return '';
  if (sectionType === 0 || sectionType === 1) return generalIcon(sectionType === 1);
  // SODA stores I/H as 2; its section icon/display vocabulary uses 3.
  const v = sectionType === 2 ? 3 : sectionType;
  const solid = Boolean(used);
  const sw = solid ? '1.6' : '2.4';
  const outline = 'fill="none" stroke="currentColor" stroke-width="' + sw +
    '" stroke-linecap="square" stroke-linejoin="miter"';
  const filled = 'fill="currentColor" stroke="currentColor" stroke-width="' + sw +
    '" stroke-linecap="square" stroke-linejoin="miter"';
  const softFill = solid ? '1' : '0.22';
  let body = '';
  if (v === 3) {
    body = '<path ' + (solid ? filled : outline) + ' d="M5 5h22v5h-8v12h8v5H5v-5h8V10H5z"/>';
  } else if (v === 4) {
    body = '<path ' + (solid ? filled : outline) + ' d="M25 5H7v22h18v-4H11V9h14z"/>';
  } else if (v === 5) {
    body = '<path ' + (solid ? filled : outline) + ' d="M5 5h22v5h-8v17h-6V10H5z"/>';
  } else if (v === 6) {
    body = solid
      ? '<path fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width="' + sw +
        '" stroke-linejoin="miter" d="M5 6h22v20H5zM10 10h12v12H10z"/>'
      : '<rect ' + outline + ' x="5" y="6" width="22" height="20"/>' +
        '<rect ' + outline + ' x="10" y="10" width="12" height="12"/>';
  } else if (v === 7) {
    body = '<path ' + (solid ? filled : outline) + ' d="M7 5h5v17h16v5H7z"/>';
  } else if (v === 8) {
    body = solid
      ? '<path fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width="' + sw +
        '" d="M16 5a11 11 0 1 0 0 22a11 11 0 1 0 0-22zM16 9a7 7 0 1 0 0 14a7 7 0 1 0 0-14z"/>'
      : '<circle ' + outline + ' cx="16" cy="16" r="11"/>' +
        '<circle ' + outline + ' cx="16" cy="16" r="7"/>';
  } else if (v === 9) {
    body = '<circle cx="16" cy="16" r="10.5" fill="currentColor" fill-opacity="' + softFill +
      '" stroke="currentColor" stroke-width="' + sw + '"/>';
  } else if (v === 10) {
    body = '<rect x="6" y="9" width="20" height="14" fill="currentColor" fill-opacity="' + softFill +
      '" stroke="currentColor" stroke-width="' + sw + '" stroke-linejoin="miter"/>';
  } else if (v === 11) {
    body = '<path d="M5 5h15v15h7v5H15V10H5z" fill="currentColor" fill-opacity="' + softFill +
      '" stroke="currentColor" stroke-width="2.2" stroke-linejoin="miter"/>';
  } else if (v === 12) {
    body = '<path d="M4 6h24v5H18v10h7v5H7v-5h7V11H4z" fill="currentColor" fill-opacity="' + softFill +
      '" stroke="currentColor" stroke-width="2.2" stroke-linejoin="miter"/>';
  } else if (v === 14) {
    body = '<path d="M13 4h6v9h9v6h-9v9h-6v-9H4v-6h9z" fill="currentColor" fill-opacity="' + softFill +
      '" stroke="currentColor" stroke-width="2.2" stroke-linejoin="miter"/>';
  } else if (v === 15) {
    body = '<path d="M4 5h10v20h-4V9H4zM18 5h10v4h-6v16h-4z" fill="currentColor" fill-opacity="' + softFill +
      '" stroke="currentColor" stroke-width="2.2" stroke-linejoin="miter"/>';
  } else if (v === 16) {
    body = '<path d="M4 5h24v5H4zM4 22h24v5H4zM11 10h4v12h-4zM18 10h4v12h-4z" ' +
      'fill="currentColor" fill-opacity="' + softFill + '" stroke="currentColor" stroke-width="2.1" stroke-linejoin="miter"/>';
  } else {
    // Original SODA has no icon for Arbitrary (13). Unknown metadata likewise
    // stays empty instead of manufacturing a shape from a section's name.
    return '';
  }
  return '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">' + body + '</svg>';
}
