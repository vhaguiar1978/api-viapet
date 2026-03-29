// Configuração para Sequelize CLI
require('dotenv').config({ 
  path: process.env.NODE_ENV === 'development' ? '.env.development' : '.env' 
});

const config = {
  development: {
    use_env_variable: process.env.DATABASE_URL ? 'DATABASE_URL' : undefined,
    username: process.env.DB_USER || 'viapet',
    password: process.env.DB_PASS,
    database: process.env.DB_NAME || 'viapet',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: process.env.DB_DIALECT || (process.env.DATABASE_URL ? 'postgres' : 'mysql'),
    timezone: process.env.DATABASE_URL ? undefined : '-03:00',
    dialectOptions: process.env.DATABASE_URL ? {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    } : undefined
  },
  production: {
    use_env_variable: process.env.DATABASE_URL ? 'DATABASE_URL' : undefined,
    username: process.env.DB_USER || 'viapet',
    password: process.env.DB_PASS,
    database: process.env.DB_NAME || 'viapet',
    host: process.env.DB_HOST || 'api.viapet.app',
    port: process.env.DB_PORT || 3306,
    dialect: process.env.DB_DIALECT || (process.env.DATABASE_URL ? 'postgres' : 'mysql'),
    timezone: process.env.DATABASE_URL ? undefined : '-03:00',
    dialectOptions: process.env.DATABASE_URL ? {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    } : undefined
  }
};

module.exports = config;
