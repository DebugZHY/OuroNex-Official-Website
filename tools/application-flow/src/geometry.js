export function roundedPath(points, radius = 12) {
  const vertices = points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  if (vertices.length < 2) return '';
  let path = `M ${vertices[0].x} ${vertices[0].y}`;
  for (let index = 1; index < vertices.length - 1; index += 1) {
    const previous = vertices[index - 1];
    const corner = vertices[index];
    const next = vertices[index + 1];
    const before = { x: corner.x - previous.x, y: corner.y - previous.y };
    const after = { x: next.x - corner.x, y: next.y - corner.y };
    const beforeLength = Math.hypot(before.x, before.y);
    const afterLength = Math.hypot(after.x, after.y);
    if (before.x * after.y === before.y * after.x) {
      path += ` L ${corner.x} ${corner.y}`;
      continue;
    }
    const bend = Math.min(radius, beforeLength / 2, afterLength / 2);
    const entry = { x: corner.x - before.x / beforeLength * bend, y: corner.y - before.y / beforeLength * bend };
    const exit = { x: corner.x + after.x / afterLength * bend, y: corner.y + after.y / afterLength * bend };
    path += ` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
  }
  const last = vertices[vertices.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

export function layoutBounds(layout) {
  const points = Object.values(layout.positions).flatMap(position => [position, { x: position.x + layout.nodeSize.width, y: position.y + layout.nodeSize.height }]);
  for (const route of Object.values(layout.routes || {})) {
    points.push(...(route.via || []));
    if (route.label) {
      const halfWidth = route.label.text.length * 3.2 + 8;
      points.push({ x: route.label.x - halfWidth, y: route.label.y - 9 }, { x: route.label.x + halfWidth, y: route.label.y + 9 });
    }
  }
  const x = Math.min(...points.map(point => point.x));
  const y = Math.min(...points.map(point => point.y));
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y };
}
