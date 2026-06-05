import { Router } from "express";
import { getProfessor } from "../controllers/professorsController.ts";

const professorsRouter = Router();

professorsRouter.get("/:id", getProfessor);

export default professorsRouter;
