function debugPrint(polygonPoints: string): void {
  // create hidden svg element in document, add polygon element and print to console
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const svgPolygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  svgPolygon.setAttribute("points", polygonPoints);
  svg.appendChild(svgPolygon);
  // transform svg to base64 and print to console
  const svgData = new XMLSerializer().serializeToString(svg);
  const svgBase64 = btoa(svgData);
  const svgUrl = "data:image/svg+xml;base64," + svgBase64;
  const debug = `background: url(${svgUrl}) no-repeat; line-height: 300px; padding-left: 600px`;
  console.log("%c ", debug);
  svg.remove();
}

export function debug(contour: Array<[number, number]>, title?: string): void {
  if (title) console.log(title);
  debugPrint(contour.map(([x, y]) => `${x},${y}`).join(" "));
}

export function debugPolygon(contour: Array<{ x: number; y: number }>, title?: string): void {
  if (title) console.log(title);
  debugPrint(contour.map(({ x, y }) => `${x},${y}`).join(" "));
}
