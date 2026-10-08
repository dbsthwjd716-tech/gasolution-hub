// 연결이 순간적으로 끊겼을 때(응답을 받기 전 'fetch failed') 한 번만 다시 시도하는 fetch
//   읽기 요청에만 씀: 저장 요청을 다시 보내면 두 번 저장될 수 있어서
export async function fetchRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    await new Promise((r) => setTimeout(r, 300));
    return fetch(input, init);
  }
}

// Supabase 연결용: 조회(GET·HEAD)만 다시 시도, 저장(POST·PATCH·DELETE)은 그대로
export const readRetryFetch: typeof fetch = (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  return method === "GET" || method === "HEAD" ? fetchRetry(input, init) : fetch(input, init);
};
