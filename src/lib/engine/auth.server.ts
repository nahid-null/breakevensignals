export async function authenticateEngine(request: Request): Promise<Response | null> {
  const secret = process.env['ENGINE_SHARED_SECRET'];
  if (!secret) return Response.json({ error: "Engine key is not configured" }, { status: 503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(token), digest(secret)) ? null : Response.json({ error: "Unauthorized" }, { status: 401 });
}