import type { Request, Response } from "express";
import {
  fetchEvaluationDrilldown,
  fetchEvaluationSummaries,
} from "../services/avalancheService.ts";

export async function getEvaluationSummaries(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const query = req.query.query;

    if (typeof query !== "string" || !query.trim()) {
      res.status(400).json({
        error: "A non-empty query parameter is required.",
      });
      return;
    }

    const evaluations = await fetchEvaluationSummaries(query);

    res.json({
      query,
      count: evaluations.length,
      evaluations,
    });
  } catch (error) {
    console.error("Failed to fetch evaluation summaries:", error);

    res.status(500).json({
      error: "Unable to fetch BC evaluation data.",
    });
  }
}

export async function getEvaluationDrilldown(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { fullCourseCode, instructorName, semester } = req.query;

    if (
      typeof fullCourseCode !== "string" ||
      typeof instructorName !== "string" ||
      typeof semester !== "string"
    ) {
      res.status(400).json({
        error:
          "fullCourseCode, instructorName, and semester query parameters are required.",
      });
      return;
    }

    const drilldown = await fetchEvaluationDrilldown({
      fullCourseCode,
      instructorName,
      semester,
    });

    if (!drilldown) {
      res.status(404).json({
        error: "No matching drilldown data found.",
      });
      return;
    }

    res.json(drilldown);
  } catch (error) {
    console.error("Failed to fetch evaluation drilldown:", error);

    res.status(500).json({
      error: "Unable to fetch detailed BC evaluation data.",
    });
  }
}