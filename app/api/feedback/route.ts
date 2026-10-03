import { getD1 } from "../../../db";

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "نوع درخواست نامعتبر است." }, { status: 415 });
  }
  const size = Number(request.headers.get("content-length") || 0);
  if (size > 4096) return Response.json({ error: "درخواست بیش از حد بزرگ است." }, { status: 413 });
  let input: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return Response.json({ error: "درخواست بیش از حد بزرگ است." }, { status: 413 });
    input = JSON.parse(raw);
  } catch {
    return Response.json({ error: "درخواست نامعتبر است." }, { status: 400 });
  }
  if (!input || typeof input !== "object") {
    return Response.json({ error: "درخواست نامعتبر است." }, { status: 400 });
  }
  const { rating, note } = input as { rating?: unknown; note?: unknown };
  if (rating !== "positive" && rating !== "negative") {
    return Response.json({ error: "نوع بازخورد نامعتبر است." }, { status: 400 });
  }
  if (typeof note !== "string" || note.length > 600) {
    return Response.json({ error: "متن بازخورد نامعتبر است." }, { status: 400 });
  }
  try {
    await getD1().prepare("INSERT INTO feedback (rating, note, created_at) VALUES (?, ?, ?)")
      .bind(rating, note.trim(), Date.now()).run();
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("Feedback write failed", error);
    return Response.json({ error: "ثبت بازخورد فعلاً ممکن نیست." }, { status: 503 });
  }
}
