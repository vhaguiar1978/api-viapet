import { Sequelize } from "sequelize";
import "../config/env.js";

const isDevelopment = process.env.NODE_ENV === "development";
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

const dbConfig = {
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: isDevelopment ? process.env.DB_HOST || "localhost" : process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  dialect: process.env.DB_DIALECT || (hasDatabaseUrl ? "postgres" : "mysql"),
  logging: isDevelopment ? console.log : false,
  timezone: "-03:00",
};

const sharedOptions = {
  dialect: dbConfig.dialect,
  logging: dbConfig.logging,
  ...(dbConfig.dialect === "mysql" ? { timezone: dbConfig.timezone } : {}),
  ...(dbConfig.dialect === "postgres"
    ? {
        dialectOptions: {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        },
        pool: {
          max: 10,
          min: 0,
          acquire: 30000,
          idle: 10000,
        },
      }
    : {}),
};

const sequelize = hasDatabaseUrl
  ? new Sequelize(process.env.DATABASE_URL, sharedOptions)
  : new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
      host: dbConfig.host,
      port: dbConfig.port,
      ...sharedOptions,
    });

export default sequelize;
