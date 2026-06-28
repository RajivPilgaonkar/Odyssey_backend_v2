'use strict';

var env       = process.env.NODE_ENV || 'development';
var config    = require(__dirname + '/../config/config.js')[env];
var db        = {};

console.log('===========================================');
console.log('MODE --> ',process.env.NODE_ENV ? process.env.NODE_ENV : 'development');
console.log('running on ... DB: ' + config.database + ' host: ' + config.host);
console.log('===========================================');

db.dbConfig = {
  server: config.host,
  database: config.database,
  user: config.username,
  password: config.password,
  port: config.port,
/*  
  pool: {
    max: 10,
    min: 5,
    idleTimeoutMillis: 30000
  },
*/  
  options: {
    //encrypt: false, 
    trustServerCertificate: true 
  }    
}

module.exports = db;

