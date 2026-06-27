import dotenv from "dotenv";

dotenv.config();

export const APP_PORT = process.env.APP_PORT || 3000;
export const DB_HOST = process.env.DB_HOST || "localhost";
export const DB_USER = process.env.DB_USER || "root";
export const DB_PASSWORD = process.env.DB_PASSWORD || "";
export const DB_NAME = process.env.DB_NAME || "komotia";
export const DB_PORT = Number(process.env.DB_PORT || 3306);
export const DB_SSL = process.env.DB_SSL === "true";