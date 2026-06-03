import { Router } from "express";
import {
  exploreCourses,
  getCourse,
  getCourseProfessors,
  getFilters,
  searchCourses,
} from "../controllers/coursesController.ts";

const coursesRouter = Router();

coursesRouter.get("/search", searchCourses);
coursesRouter.get("/explore", exploreCourses);
coursesRouter.get("/filters", getFilters);
coursesRouter.get("/:courseCode/professors", getCourseProfessors);
coursesRouter.get("/:courseCode", getCourse);

export default coursesRouter;
