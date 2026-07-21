export interface PdfGeneratorPlugin {
  echo(options: { value: string }): Promise<{ value: string }>;
}
