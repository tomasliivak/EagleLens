import type { Request, Response } from "express";
import { supabase } from "../lib/supabase.ts";
import { COLLEGE_LABELS } from "./coursesController.ts";

// numeric columns come back from PostgREST as strings; counts can too.
const num = (v: string | null) => (v === null ? null : Number(v));

const collegeLabel = (code: string | null) =>
  code === null ? null : COLLEGE_LABELS[code] ?? code;

type Entity = "classes" | "professors" | "departments" | "schools";
const ENTITIES: Entity[] = ["classes", "professors", "departments", "schools"];

const METRICS = ["rating", "difficulty", "workload", "reviews", "variation"];

// Every RPC returns these metric columns; the name/secondary columns differ.
type RankRow = {
  rating: string | null;
  difficulty: string | null;
  workload: string | null;
  review_count: string | number | null;
  variation: string | null;
  // entity-specific identity columns (only some present per RPC)
  course_code?: string;
  title?: string | null;
  instructor_id?: number;
  name?: string | null;
  department_name?: string | null;
  department_code?: string;
  college?: string | null;
};

// GET /api/rankings/:entity?metric=rating&order=desc&minEvals=5&limit=25&offset=0
// Ranks classes / professors / departments / schools across ALL evaluations.
export async function getRankings(req: Request, res: Response): Promise<void> {
  const entity = req.params.entity as Entity;
  if (!ENTITIES.includes(entity)) {
    res.status(400).json({ error: "Unknown ranking entity." });
    return;
  }

  const intOf = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const metricRaw = typeof req.query.metric === "string" ? req.query.metric : "";
  const metric = METRICS.includes(metricRaw) ? metricRaw : "rating";
  const order = req.query.order === "asc" ? "asc" : "desc";
  const minEvals = Math.max(0, intOf(req.query.minEvals, 10));
  const limit = Math.min(100, Math.max(1, intOf(req.query.limit, 25)));
  const offset = Math.max(0, intOf(req.query.offset, 0));

  const fn = {
    classes: "rank_classes",
    professors: "rank_professors",
    departments: "rank_departments",
    schools: "rank_schools",
  }[entity];

  const params: Record<string, unknown> = {
    p_metric: metric,
    p_order: order,
    p_min_evals: minEvals,
    p_limit: limit,
    p_offset: offset,
  };
  // Credits filter only applies to classes; null = all. Other entities' RPCs
  // don't take this argument.
  if (entity === "classes") {
    const credits = Number(req.query.credits);
    params.p_credits = Number.isFinite(credits) ? credits : null;
    const lvl = typeof req.query.studentLevel === "string" ? req.query.studentLevel : "";
    params.p_student_level =
      lvl === "Undergraduate" || lvl === "Graduate" ? lvl : null;
  }

  const { data, error } = await supabase.rpc(fn, params);

  if (error) {
    console.error("Rankings lookup failed:", error.message);
    res.status(500).json({ error: "Rankings lookup failed." });
    return;
  }

  const rows = (data ?? []) as RankRow[];

  const items = rows.map((r) => {
    const base = {
      rating: num(r.rating),
      difficulty: num(r.difficulty),
      workload: num(r.workload),
      reviewCount: Number(r.review_count ?? 0),
      variation: num(r.variation),
    };
    switch (entity) {
      case "classes":
        return {
          id: r.course_code!,
          primary: r.title ?? r.course_code!,
          primaryCode: r.course_code!,
          secondary: r.department_name ?? null,
          ...base,
        };
      case "professors":
        return {
          id: String(r.instructor_id),
          primary: r.name ?? "—",
          primaryCode: null,
          secondary: r.department_name ?? null,
          ...base,
        };
      case "departments":
        return {
          id: r.department_code!,
          primary: r.name ?? r.department_code!,
          primaryCode: null,
          secondary: collegeLabel(r.college ?? null),
          ...base,
        };
      case "schools":
        return {
          id: r.college!,
          primary: collegeLabel(r.college ?? null) ?? r.college!,
          primaryCode: null,
          secondary: null,
          ...base,
        };
    }
  });

  res.json({ entity, metric, order, minEvals, items, hasMore: rows.length === limit });
}
