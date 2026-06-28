/*==================================================*/
/*=== The order of setup below is very important ===*/
/*=== Do not change anything =======================*/
/*==================================================*/

const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const { Sequelize } = require('sequelize');

require("dotenv").config();


// on uncaught execptions, but this may require a RESTART
process.on('uncaughtException', function (error) {
  console.log(error.stack);
});

var cors = require('cors')

var env = process.env.NODE_ENV || 'development';

// pick up environment variables from the .env file
if (process.env.NODE_ENV === 'production') {
  require('dotenv').config({ path: './config/.env.production' });
} else {
  require('dotenv').config({ path: './config/.env' });
}

// this has to be after dotenv as it picks up values from there
const keys = require('./config/keys');

const app = express();
app.use( express.static(__dirname + '/public'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use(helmet());

// this will read the index file in the models directory
const db = require('./models');

// Without CORS, you may not be able to connect to node via React ...
// when CORS is used the endpoints are executed in the production mode too
app.use(cors());

/*=== configure it once ===*/
const sequelize = new Sequelize(
  db.dbConfig.database, db.dbConfig.user, db.dbConfig.password, 
    {
      host: db.dbConfig.server,
      port: db.dbConfig.port,
      dialect: 'mssql',
      pool: {
        max: 50,
        min: 0,
        idle: 10000
      },
      dialectOptions: {
        options: { encrypt: true }
      },
      logging: false      
    }
);

require('./routes/authRoutes')(app);
require('./routes/dbRoutes')(app,db,sequelize);
require('./routes/reports/vouchers/voucherRoutes')(app,db,sequelize);
require('./routes/reports/vouchers/voucherServicesRoutes')(app,db,sequelize);
require('./routes/reports/presto/prestoRoutesItinerary')(app,db,sequelize);
require('./routes/reports/presto/docx/prestoDocx')(app,db,sequelize);
require('./routes/api/presto/vamoos/vamoosPrestoItinerary')(app,db,sequelize);
require('./routes/mailRoutes')(app,db);


// Run express server on port 5100
// React client will run on port 3000
const port = process.env.PORT || 5100;
app.listen(port,() => {
  console.log(`Running on port : ${port} in ${env} mode`);
});
