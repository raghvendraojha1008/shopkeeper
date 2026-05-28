import { WebPlugin } from '@capacitor/core';

import type { PdfGeneratorPlugin } from './definitions';

export class PdfGeneratorWeb extends WebPlugin implements PdfGeneratorPlugin {
  async echo(options: { value: string }): Promise<{ value: string }> {
    console.log('ECHO', options);
    return options;
  }
}
