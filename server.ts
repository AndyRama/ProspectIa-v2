import express from "express";
import app from "./server/index";

const server = express();
server.use(app);
export default server;
