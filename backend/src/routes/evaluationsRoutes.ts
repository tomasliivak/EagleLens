import { Router } from "express";
import {
  getEvaluationDrilldown,
  getEvaluationSummaries,
} from "../controllers/evaluationsController.ts";

const evaluationsRouter = Router();

evaluationsRouter.get("/summary", getEvaluationSummaries);
evaluationsRouter.get("/drilldown", getEvaluationDrilldown);

export default evaluationsRouter;
