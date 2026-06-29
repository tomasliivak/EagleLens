import { Router } from "express";
import { getDepartment } from "../controllers/departmentsController.ts";

const departmentsRouter = Router();

departmentsRouter.get("/:code", getDepartment);

export default departmentsRouter;
