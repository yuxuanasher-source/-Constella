// 逐行读取 SSE 响应体，产出每个 `data:` 行的 payload 字符串。
// 事件语义（delta/usage/[DONE]）由各 provider 自己解释，这里只做传输层解析。
export async function* iterateSseData({
  body,
  onActivity,
}: {
  body: ReadableStream<Uint8Array>;
  /** 每收到一个网络 chunk 调用一次（用于重置空闲超时）。 */
  onActivity?: () => void;
}): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      onActivity?.();
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        const payload = sseDataPayload(line);
        if (payload !== null) {
          yield payload;
        }
      }
    }

    const tail = sseDataPayload(buffer.replace(/\r$/, ""));
    if (tail !== null) {
      yield tail;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // reader 已被释放/流已关闭时忽略。
    }
  }
}

function sseDataPayload(line: string): string | null {
  if (!line.startsWith("data:")) {
    return null;
  }
  const payload = line.slice("data:".length).trimStart();
  return payload.length ? payload : null;
}
