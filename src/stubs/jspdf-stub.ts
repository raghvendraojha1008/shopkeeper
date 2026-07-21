class jsPDF {
  constructor(_opts?: any) {}
  setFontSize(_size: number) { return this; }
  setFont(_font: string, _style?: string) { return this; }
  setTextColor(_r: number, _g?: number, _b?: number) { return this; }
  setFillColor(_r: number, _g?: number, _b?: number) { return this; }
  setDrawColor(_r: number, _g?: number, _b?: number) { return this; }
  setLineWidth(_w: number) { return this; }
  text(_text: string | string[], _x: number, _y: number, _opts?: any) { return this; }
  line(_x1: number, _y1: number, _x2: number, _y2: number) { return this; }
  rect(_x: number, _y: number, _w: number, _h: number, _style?: string) { return this; }
  addPage() { return this; }
  save(_filename: string) {}
  output(_type: string): any { return ''; }
  splitTextToSize(_text: string, _maxW: number): string[] { return [_text]; }
  getStringUnitWidth(_text: string): number { return _text.length * 5; }
  internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 }, pages: [null, null] };
  lastAutoTable = { finalY: 0 };
}

function autoTable(_doc: any, _opts: any) {
  (_doc as any).lastAutoTable = { finalY: (_opts.startY || 0) + 20 };
}
autoTable.default = autoTable;

export { jsPDF };
export default jsPDF;
