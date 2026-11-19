export class RequestBodyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

// Count actual streamed bytes: Content-Length can be absent or inaccurate.
export async function readBody(request: Request, limit: number) {
  const tooLarge = () => new RequestBodyError("Request body is too large", 413);
  if (Number(request.headers.get("content-length")) > limit) {
    await request.body?.cancel();
    throw tooLarge();
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJson(request: Request): Promise<unknown> {
  const bytes = await readBody(request, 64 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestBodyError("Invalid JSON request body", 400);
  }
}

export async function readUpload(request: Request) {
  // Allow multipart overhead above the separately enforced 10 MB file limit.
  const bytes = await readBody(request, 11 * 1024 * 1024);
  try {
    return await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new RequestBodyError("Invalid multipart upload", 400);
  }
}
