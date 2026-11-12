// 決定木のミニアイコン（LearningDiagram から分離）

/** 決定木のミニアイコン（7ノードの二分木） */
function TreeGlyph({ x, y, color }) {
  return (
    <g transform={`translate(${x}, ${y})`} aria-hidden="true">
      {/* 枝 */}
      <line x1="0" y1="0" x2="-14" y2="18" stroke={color} strokeWidth="1.5" />
      <line x1="0" y1="0" x2="14" y2="18" stroke={color} strokeWidth="1.5" />
      <line
        x1="-14"
        y1="18"
        x2="-21"
        y2="36"
        stroke={color}
        strokeWidth="1.2"
      />
      <line x1="-14" y1="18" x2="-7" y2="36" stroke={color} strokeWidth="1.2" />
      <line x1="14" y1="18" x2="7" y2="36" stroke={color} strokeWidth="1.2" />
      <line x1="14" y1="18" x2="21" y2="36" stroke={color} strokeWidth="1.2" />
      {/* ノード */}
      <circle cx="0" cy="0" r="4.5" fill={color} />
      <circle cx="-14" cy="18" r="3.5" fill={color} />
      <circle cx="14" cy="18" r="3.5" fill={color} />
      <circle cx="-21" cy="36" r="2.5" fill={color} opacity="0.7" />
      <circle cx="-7" cy="36" r="2.5" fill={color} opacity="0.7" />
      <circle cx="7" cy="36" r="2.5" fill={color} opacity="0.7" />
      <circle cx="21" cy="36" r="2.5" fill={color} opacity="0.7" />
    </g>
  );
}

export default TreeGlyph;
