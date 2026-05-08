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

function buildEnvConfig(defaultHost) {
  const dialect = process.env.DB_DIALECT || (databaseUrl ? 'postgres' : 'mysql');
  const base = {
    use_env_variable: databaseUrl ? 'DATABASE_URL' : undefined,
    username: firstValidEnv('DB_USER', 'PGUSER', 'POSTGRES_USER') || 'viapet',
    password: firstValidEnv('DB_PASS', 'PGPASSWORD', 'POSTGRES_PASSWORD'),
    database: firstValidEnv('DB_NAME', 'PGDATABASE', 'POSTGRES_DATABASE') || 'viapet',
    host: firstValidEnv('DB_HOST', 'PGHOST', 'POSTGRES_HOST') || defaultHost,
    port: firstValidEnv('DB_PORT', 'PGPORT', 'POSTGRES_PORT') || 3306,
    dialect,
  };

  if (dialect === 'mysql' || dialect === 'mariadb') {
    base.timezone = '-03:00';
  }

  if (databaseUrl) {
    base.dialectOptions = {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    };
  }

  return base;
}

const config = {
  development: buildEnvConfig('localhost'),
  production: buildEnvConfig('api.viapet.app'),
};

module.exports = config;
