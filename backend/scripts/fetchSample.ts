// Run with: npx tsx scripts/fetchSample.ts
// Fetches live BC course data once and saves it as a fixture for tests,
// so we don't have to hit the real API repeatedly.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBCCourses } from "../src/fetchCourses.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../data/coursesfall.sample.json");

async function main() {
  console.log("Fetching BC courses…");
  const data = await fetchBCCourses();

  console.log(`Fetched: msg=${data.msg} code=${data.code} sections=${data.payload?.length ?? 0}`);

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");

  console.log(`Saved sample to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("Failed to fetch/save sample:", err);
  process.exit(1);
});
