import { Router } from "express";
import {
  getProfessor,
  getProfessorReviewCourses,
} from "../controllers/professorsController.ts";

const professorsRouter = Router();

professorsRouter.get("/:id/review-courses", getProfessorReviewCourses);
professorsRouter.get("/:id", getProfessor);

export default professorsRouter;
