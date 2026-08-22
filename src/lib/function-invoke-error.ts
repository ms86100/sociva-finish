type InvokeResult = {
  error?: unknown;
  data?: { error?: string; pending?: boolean } | null;
};

export type ParsedFunctionError = {
  message: string;
  pending: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readContextBody(error: unknown): Promise<Record<string, unknown> | null> {
  if (!isRecord(error)) return null;
  const context = error.context as { json?: () => Promise<unknown> } | undefined;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const body = await context.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

export async function parseFunctionInvokeError(
  result: InvokeResult,
  fallback = "We couldn't complete your recharge. Please try again.",
): Promise<ParsedFunctionError> {
  const data = result.data && isRecord(result.data) ? result.data : null;
  const fromContext = await readContextBody(result.error);
  const body = data || fromContext;
  const raw = (typeof body?.error === 'string' && body.error.trim())
    || (result.error instanceof Error && result.error.message.trim() && !/non-2xx status code/i.test(result.error.message)
      ? result.error.message.trim()
      : '');
  const pending = body?.pending === true
    || /pending|authorized|processing|still being confirmed/i.test(raw);
  return { message: raw || fallback, pending };
}

export async function functionInvokeErrorMessage(
  result: InvokeResult,
  fallback = "We couldn't complete your recharge. Please try again.",
): Promise<string> {
  return (await parseFunctionInvokeError(result, fallback)).message;
}
