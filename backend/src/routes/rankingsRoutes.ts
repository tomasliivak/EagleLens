import { Router } from "express";
import { getRankings } from "../controllers/rankingsController.ts";

const rankingsRouter = Router();

rankingsRouter.get("/:entity", getRankings);

export default rankingsRouter;
