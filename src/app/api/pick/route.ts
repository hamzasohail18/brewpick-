import { NextResponse } from "next/server";
import { ANON, dbAs } from "@/lib/db";
import { parseQuiz } from "@/lib/scoring/quiz";
import { loadCandidates } from "@/lib/scoring/candidates";

// Candidate drinks for "Pick for me". Takes only the drink style and budget: the user's location,
// cards and goal stay on the phone, where the ranking happens.
export async function GET(req: Request) {
  const quiz = parseQuiz(new URL(req.url).searchParams);
  const data = await dbAs(ANON, (tx) => loadCandidates(tx, { style: quiz.style ?? "any", budgetMax: quiz.budgetMax ?? null }));
  return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
}
