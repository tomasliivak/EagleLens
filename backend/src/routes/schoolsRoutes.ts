import { Router } from "express";
import { getSchool } from "../controllers/schoolsController.ts";

const schoolsRouter = Router();

schoolsRouter.get("/:code", getSchool);

export default schoolsRouter;
