import { Router } from "express";
import {
  getCourse,
  getCourseProfessors,
  searchCourses,
} from "../controllers/coursesController.ts";

const coursesRouter = Router();

coursesRouter.get("/search", searchCourses);
coursesRouter.get("/:courseCode/professors", getCourseProfessors);
coursesRouter.get("/:courseCode", getCourse);

export default coursesRouter;
