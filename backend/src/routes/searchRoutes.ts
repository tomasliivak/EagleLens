import { Router } from "express";
import { search } from "../controllers/coursesController.ts";

const searchRouter = Router();

searchRouter.get("/", search);

export default searchRouter;
