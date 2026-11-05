/** 写请求先核对浏览器来源；会话 Cookie 不区分同站点的不同端口。 */
export function rejectCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const expectedOrigin = process.env.PAD_PUBLIC_ORIGIN?.trim() || new URL(request.url).origin;
  if ((origin && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "请求来源不匹配" }, { status: 403 });
  }
  return null;
}
