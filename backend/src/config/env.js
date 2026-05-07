import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..", "..");
const envPath = path.join(backendRoot, ".env");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  backendRoot,
  port: numberValue(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  auth: {
    jwtSecret: process.env.JWT_SECRET || "autofix-local-realistic-auth-secret",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d"
  },
  db: {
    host: process.env.DB_HOST || process.env.MYSQLHOST || "127.0.0.1",
    port: numberValue(process.env.DB_PORT || process.env.MYSQLPORT, 3306),
    user: process.env.DB_USER || process.env.MYSQLUSER || "root",
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || "",
    name: process.env.DB_NAME || process.env.MYSQLDATABASE || "autofix",
    connectionLimit: numberValue(process.env.DB_CONNECTION_LIMIT, 10)
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    assistantModel: process.env.OPENAI_ASSISTANT_MODEL || "gpt-5.4-mini"
  },
  mysqlRuntimeBase: process.env.MYSQL_RUNTIME_BASE || path.join(backendRoot, "mysql-runtime", "mysql-8.0.45-winx64"),
  mysqlRuntimeConfig: process.env.MYSQL_RUNTIME_CONFIG || path.join(backendRoot, "mysql-runtime", "my.ini")
};

export default env;
