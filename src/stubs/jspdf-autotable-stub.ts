function autoTable(doc: any, opts: any) {
  (doc as any).lastAutoTable = { finalY: (opts.startY || 0) + 20 };
}
export default autoTable;
