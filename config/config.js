module.exports = {
  development: {
    // these are read from the config/.env file
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOSTNAME,
    port: parseInt(process.env.DB_PORT),
    dialect: process.env.DB_DIALECT,
		//encrypt:  true,
		//packetSize: 16368
  },
  test: {
    dialect: "sqlite",
    storage: ":memory:"
  },
  production: {
    // here you set the variables in your script file while running in production
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOSTNAME,
    port: parseInt(process.env.DB_PORT),
    dialect: process.env.DB_DIALECT,
		//	encrypt:  true,
		//packetSize: 16368	
  }
};
