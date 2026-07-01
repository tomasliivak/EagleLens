// Shared Supabase access for build-time scripts (sitemap + prerender).
// Both enumerate every course/professor/department from the same rank_* RPCs that power the
// on-site ranking pages. Credentials are optional: callers degrade to a partial/static build
// rather than failing when no key is present.

export const SITE_URL = (process.env.SITE_URL || "https://eaglelens.org").replace(/\/+$/, "");
export const SUPABASE_URL = (process.env.SUPABASE_URL || "https://jziyrjavclicsjbealml.supabase.co").replace(/\/+$/, "");
export const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Readable names for BC's college codes (mirrors COLLEGE_LABELS in
// backend/src/controllers/coursesController.ts). Schools are this fixed set — no DB query needed.
export const COLLEGE_LABELS = {
  MCAS: "Arts & Sciences",
  CSOM: "Carroll School of Management",
  CSON: "Connell School of Nursing",
  LSOE: "Lynch School of Education",
  LAW: "Law School",
  STM: "School of Theology & Ministry",
  SSW: "School of Social Work",
  MCBC: "Woods College",
};
export const SCHOOL_CODES = Object.keys(COLLEGE_LABELS);

const PAGE_SIZE = 1000;

// Page through a rank_* RPC and collect the full row objects (course_code/instructor_id plus
// title/name, department_name, rating, difficulty, workload, review_count).
export async function fetchRankRows(fn) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_metric: "rating",
        p_order: "desc",
        p_min_evals: 0,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      }),
    });
    if (!res.ok) {
      throw new Error(`${fn} -> HTTP ${res.status} ${await res.text()}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}
