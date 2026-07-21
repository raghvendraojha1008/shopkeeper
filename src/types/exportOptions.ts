/**
 * Shared export options type — used by ExportOptionsModal, pdfGenerator, and the view files.
 */
export interface ExportOptions {
  // Reference price fields — OFF by default (internal / sensitive)
  includePurchaseRateRef: boolean;  // customer ledger: "Our Cost / Purchase Rate"
  includeSalePriceRef: boolean;     // supplier ledger: "Sale Price / Market Rate"
  includeSellerInvoiceNo: boolean;  // Seller invoice reference number

  // Transaction detail fields — ON by default
  includeTransport: boolean;        // Vehicle number + rent
  includeNotes: boolean;            // Notes / remarks on each record
  includeDiscount: boolean;         // Discount amounts
  includePaymentMode: boolean;      // Payment mode on payment rows
  includeReceivedBy: boolean;       // "Collected / Paid by" person on payments
  includeGst: boolean;              // GST % shown on item rows

  // Sections — ON by default
  includeMiscCharges: boolean;      // Services / misc charges section
  includeOpeningBalance: boolean;   // Opening balance row at top
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includePurchaseRateRef: false,
  includeSalePriceRef: false,
  includeSellerInvoiceNo: false,
  includeTransport: true,
  includeNotes: true,
  includeDiscount: true,
  includePaymentMode: true,
  includeReceivedBy: true,
  includeGst: true,
  includeMiscCharges: true,
  includeOpeningBalance: true,
};
