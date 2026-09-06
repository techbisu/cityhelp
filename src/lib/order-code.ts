/**
 * CityHelp — Order code generation with retry on race condition.
 *
 * Codes are zero-padded to 6 digits for correct string sorting:
 * "001001" < "001002" < ... < "009999" < "010000"
 *
 * This fixes the lexicographic sorting bug where "999" > "1000".
 */
import { db } from "./db";

const MAX_RETRIES = 5;
const STARTING_CODE = 1001;
const PAD_WIDTH = 6;

function padCode(num: number): string {
  return String(num).padStart(PAD_WIDTH, "0");
}

function parseCode(code: string): number {
  return parseInt(code, 10) || STARTING_CODE;
}

/**
 * Execute an order creation with automatic retry on P2002 (unique constraint violation).
 * Uses padded 6-digit codes for correct lexicographic ordering.
 */
export async function createOrderWithRetry<T>(
  tenantId: string,
  createFn: (code: string) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const lastOrder = await db.order.findFirst({
      where: { tenantId },
      orderBy: { code: "desc" },
      select: { code: true },
    });
    const lastNum = lastOrder ? parseCode(lastOrder.code) : STARTING_CODE - 1;
    const nextCode = padCode(lastNum + 1 + attempt);
    try {
      return await createFn(nextCode);
    } catch (e: unknown) {
      lastError = e;
      if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
        continue;
      }
      throw e;
    }
  }
  // Fallback: timestamp-based code
  return createFn(padCode(Date.now() % 1000000));
}
