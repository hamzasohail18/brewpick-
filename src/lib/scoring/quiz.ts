// The 4-tap quiz (Section 3E): budget -> goal -> drink style -> distance. Answers live in the URL
// (?b=800&g=cheapest&s=hot-milk&d=3) so each tap is one link and Back works as expected.

import { GOALS, STYLES, type Answers, type Goal, type Style } from "./engine";

export const BUDGETS = [
  { value: "500", label: "Up to Rs 500" },
  { value: "800", label: "Up to Rs 800" },
  { value: "1200", label: "Up to Rs 1,200" },
  { value: "any", label: "No limit" },
] as const;

export const GOAL_OPTIONS: { value: Goal; label: string; hint: string }[] = [
  { value: "cheapest", label: "Cheapest", hint: "Lowest price after deals" },
  { value: "healthiest", label: "Healthiest", hint: "Fewest calories" },
  { value: "strongest", label: "Strongest", hint: "Most caffeine" },
  { value: "beans", label: "Best beans", hint: "Single origin, Arabica" },
  { value: "deal", label: "Best deal", hint: "Biggest saving with your cards" },
];

export const STYLE_OPTIONS: { value: Style; label: string }[] = [
  { value: "hot-milk", label: "Hot, with milk" },
  { value: "hot-black", label: "Hot, black" },
  { value: "iced-milk", label: "Iced, with milk" },
  { value: "iced-black", label: "Iced, black" },
  { value: "any", label: "Surprise me" },
];

export const DISTANCES = [
  { value: "1", label: "Walking distance", hint: "Within 1 km" },
  { value: "3", label: "Nearby", hint: "Within 3 km" },
  { value: "10", label: "Across town", hint: "Within 10 km" },
  { value: "any", label: "Anywhere", hint: "Distance doesn't matter" },
] as const;

export interface QuizState {
  budgetMax?: number | null; // undefined = not answered, null = no limit
  goal?: Goal;
  style?: Style;
  maxKm?: number | null;
}

type Input = URLSearchParams | Record<string, string | string[] | undefined>;
const get = (input: Input, k: string) => {
  const v = input instanceof URLSearchParams ? input.get(k) : input[k];
  return Array.isArray(v) ? v[0] : (v ?? undefined);
};

export function parseQuiz(input: Input): QuizState {
  const s: QuizState = {};
  const b = get(input, "b");
  if (b === "any") s.budgetMax = null;
  else if (b && /^\d{2,5}$/.test(b)) s.budgetMax = Number(b);
  const g = get(input, "g");
  if (g && (GOALS as readonly string[]).includes(g)) s.goal = g as Goal;
  const st = get(input, "s");
  if (st && (STYLES as readonly string[]).includes(st)) s.style = st as Style;
  const d = get(input, "d");
  if (d === "any") s.maxKm = null;
  else if (d && /^\d{1,3}$/.test(d) && Number(d) > 0) s.maxKm = Number(d);
  return s;
}

export type Step = "budget" | "goal" | "style" | "distance" | "result";

export function currentStep(s: QuizState): Step {
  if (s.budgetMax === undefined) return "budget";
  if (!s.goal) return "goal";
  if (!s.style) return "style";
  if (s.maxKm === undefined) return "distance";
  return "result";
}

export function complete(s: QuizState): Answers | null {
  return currentStep(s) === "result" ? { budgetMax: s.budgetMax!, goal: s.goal!, style: s.style!, maxKm: s.maxKm! } : null;
}

export function quizHref(s: QuizState): string {
  const p = new URLSearchParams();
  if (s.budgetMax !== undefined) p.set("b", s.budgetMax === null ? "any" : String(s.budgetMax));
  if (s.goal) p.set("g", s.goal);
  if (s.style) p.set("s", s.style);
  if (s.maxKm !== undefined) p.set("d", s.maxKm === null ? "any" : String(s.maxKm));
  const qs = p.toString();
  return qs ? `/pick?${qs}` : "/pick";
}
