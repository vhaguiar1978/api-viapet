// Configuração para Sequelize CLI
require('dotenv').config({ 
  path: process.env.NODE_ENV === 'development' ? '.env.development' : '.env' 
});

function firstValidEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value !== 'undefined' && value !== 'null') {
      return value;
    }
  }
  return undefined;
}

const databaseUrl = firstValidEnv(
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'SUPABASE_DATABASE_URL',
  'SUPABASE_DB_URL',
);

const config = {
  development: {
    use_env_variable: databaseUrl ? 'DATABASE_URL' : undefined,
    username: firstValidEnv('DB_USER', 'PGUSER', 'POSTGRES_USER') || 'viapet',
    password: firstValidEnv('DB_PASS', 'PGPASSWORD', 'POSTGRES_PASSWORD'),
    database: firstValidEnv('DB_NAME', 'PGDATABASE', 'POSTGRES_DATABASE') || 'viapet',
    host: firstValidEnv('DB_HOST', 'PGHOST', 'POSTGRES_HOST') || 'localhost',
    port: firstValidEnv('DB_PORT', 'PGPORT', 'POSTGRES_PORT') || 3306,
    dialect: process.env.DB_DIALECT || (databaseUrl ? 'postgres' : 'mysql'),
    timezone: databaseUrl ? undefined : '-03:00',
    dialectOptions: databaseUrl ? {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    } : undefined
  },
  production: {
    use_env_variable: databaseUrl ? 'DATABASE_URL' : undefined,
    username: firstValidEnv('DB_USER', 'PGUSER', 'POSTGRES_USER') || 'viapet',
    password: firstValidEnv('DB_PASS', 'PGPASSWORD', 'POSTGRES_PASSWORD'),
    database: firstValidEnv('DB_NAME', 'PGDATABASE', 'POSTGRES_DATABASE') || 'viapet',
    host: firstValidEnv('DB_HOST', 'PGHOST', 'POSTGRES_HOST') || 'api.viapet.app',
    port: firstValidEnv('DB_PORT', 'PGPORT', 'POSTGRES_PORT') || 3306,
    dialect: process.env.DB_DIALECT || (databaseUrl ? 'postgres' : 'mysql'),
    timezone: databaseUrl ? undefined : '-03:00',
    dialectOptions: databaseUrl ? {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    } : undefined
  }
};

module.exports = config;
