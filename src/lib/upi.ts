/**
 * CityHelp — UPI Payment Link generator
 *
 * Generates UPI deep links that work across Indian UPI apps
 * (PhonePe, Google Pay, Paytm, BHIM, etc.)
 *
 * Format: upi://pay?pa=PAYEE_VPA&pn=PAYEE_NAME&am=AMOUNT&cu=INR&tn=NOTE&tr=TXN_REF
 *
 * Also generates a web-friendly fallback link.
 */

interface UpiLinkParams {
  payeeVpa: string;      // e.g. "shantiexpress@okhdfcbank"
  payeeName: string;     // e.g. "Shanti Express"
  amount: number;        // paise (we convert to rupees)
  note: string;          // transaction note (order code)
  txnRef: string;        // transaction reference (order ID)
}

/**
 * Generate the UPI deep link.
 * Opens directly in a UPI app on mobile.
 */
export function generateUpiDeepLink(params: UpiLinkParams): string {
  const amountRupees = (params.amount / 100).toFixed(2);
  const encoded = {
    pa: encodeURIComponent(params.payeeVpa),
    pn: encodeURIComponent(params.payeeName),
    am: encodeURIComponent(amountRupees),
    cu: "INR",
    tn: encodeURIComponent(params.note),
    tr: encodeURIComponent(params.txnRef),
  };
  return `upi://pay?pa=${encoded.pa}&pn=${encoded.pn}&am=${encoded.am}&cu=${encoded.cu}&tn=${encoded.tn}&tr=${encoded.tr}`;
}

/**
 * Generate a web fallback link that lists UPI apps to choose from.
 * On desktop, shows a QR code. On mobile, opens the UPI app picker.
 */
export function generateUpiWebLink(params: UpiLinkParams): string {
  const deepLink = generateUpiDeepLink(params);
  // Use upi.link as a universal resolver (or could be our own /api/upi/redirect)
  return `${process.env.NEXT_PUBLIC_APP_URL || "https://cityhelp.app"}/pay?link=${encodeURIComponent(deepLink)}`;
}

/**
 * Build the WhatsApp message text for a payment request.
 */
export function buildPaymentRequestMessage(orderCode: string, amount: number, businessName: string, upiLink: string): string {
  const amountRupees = (amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `💳 Payment request for order #${orderCode}

Amount: ₹${amountRupees}
To: ${businessName}

Pay via UPI (any app):
${upiLink}

After payment, please share the screenshot here to confirm.
Thank you! 🙏`;
}

/**
 * Build the WhatsApp message text for payment confirmation.
 */
export function buildPaymentConfirmedMessage(orderCode: string, amount: number): string {
  const amountRupees = (amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `✅ Payment confirmed for order #${orderCode}

Amount: ₹${amountRupees}
Status: Paid

Thank you for your payment! 🙏`;
}
