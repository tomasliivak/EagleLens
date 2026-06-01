import { Router } from "express";
import {
  getCourseProfessors,
  searchCourses,
} from "../controllers/coursesController.ts";

const coursesRouter = Router();

coursesRouter.get("/search", searchCourses);
coursesRouter.get("/:courseCode/professors", getCourseProfessors);

export default coursesRouter;
