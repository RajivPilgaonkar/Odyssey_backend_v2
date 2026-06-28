/*=============================================================*/
/*=== setup all the database call routes =====================*/
/*=== The routes fetch data from the tables ==================*/
/*=============================================================*/
const { Sequelize } = require('sequelize');
var sql = require('mssql');

module.exports = (app,db,sequelize) => {
  
  //*************************************************************
  app.get('/db/connect', async (req, res) => {
    try {
      await sequelize.authenticate();      
      console.log('Connection has been established successfully.');
      res.send('Connected to database !');
    } catch (error) {
      console.error('Unable to connect to the database:', error.original);
    }    
  });


  //*************************************************************
  app.get('/db/getTest', async (req, res) => {
    res.send('test');
  });
  

  //*************************************************************
  app.get('/db/getCities', async (req, res) => {

    try {
      const [results, metadata] = await sequelize.query("select cities_id, citycode, city from cities order by city");      
      res.send(results);
    } catch (err) {
      if (err.sql !== undefined) {
        console.log('sql error:',err.sql);
      } else if (err.original !== undefined) {
        console.log('connection error:',err.original);
      } else {
        console.log('unknown error:',err);
      }
    }
    
  });

  //*************************************************************
  app.get('/db/getCity/:cities_id', async (req, res) => {

    sql.connect(db.dbConfig).then( async() => {
      const res1 = await sql.query`select cities_id, citycode, city from cities
        where cities_id = ${req.params.cities_id.trim()}`;
      res.send(res1.recordset);
    }).catch((err) => {
      console.log(err);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })

  });

  //*************************************************************
  app.get('/db/getUserId/:username/:pwd', async (req, res) => {

    const qry = `SELECT AdmUsers_id, uid, SuperUser, TokenExpiryDays FROM admusers 
      WHERE uid='${req.params.username.trim()}'
      AND Pwd = '${req.params.pwd.trim()}'`;

    sql.connect(db.dbConfig).then( async() => {
      const res1 = await sql.query(`${qry}`);
      res.send(res1.recordset);
    }).catch((err) => {
      console.log('Error: ', qry);
      console.log(err);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })

  });

  //*************************************************************
  app.post('/db/getRecord', async (req, res) => {
    // declared as a post as data is sent to this route as an object

    // get call comma separated values, and trim off last comma
    let field_str = '';
    req.body.fields.map((rec) => field_str += rec + ',');    
    field_str = field_str.slice(0, -1); 
      
    // get call comma separated values, and trim off last comma
    let order_str = '';
    if (req.body.orders !== undefined) {
      req.body.orders.map((rec) => order_str += rec + ',');    
      order_str = order_str.slice(0, -1);   
    }
      
    let sqlStatement =  'SELECT ' + field_str + ' FROM ' + req.body.table + ' ' +
      ((req.body.where !== undefined) ? ' WHERE ' + req.body.where + ' ' : '') +
      ((req.body.orders !== undefined) ? ' ORDER BY ' + order_str : '') ;

    try {
      const [results, metadata] = await sequelize.query(sqlStatement);      
      res.send(results);
    } catch (err) {
      if (err.sql !== undefined) {
        console.log('Error:',err.sql);
        return res.status(400).json({ message: err.sql });
      } else if (err.original !== undefined) {
        console.log('DB Connection Error:', err.original);
        return res.status(400).json({ message: err.original });
      } else  {
        console.log('Unknown Error:', err);
        return res.status(400).json({ message: err });
      }
    }
      
  });

  //*************************************************************
  app.post('/db/getRecordRaw', async (req, res) => {
    
    // declared as a post as data is sent to this route as an object      
    let sqlStatement =  req.body.query;

    try {
      const [results, metadata] = await sequelize.query(sqlStatement);      
      res.send(results);
    } catch (err) {
      if (err.sql !== undefined) {
        console.log('Error:',err.sql);
        return res.status(400).json({ message: err.sql });
      } else if (err.original !== undefined) {
        console.log('DB Connection Error:', err.original);
        return res.status(400).json({ message: err.original });
      } else  {
        console.log('Unknown Error:', err);
        return res.status(400).json({ message: err });
      }
    }
      
  });


  //*************************************************************
  app.post('/db/executeSP', async (req, res) => {
    // declared as a post as data is sent to this route as an object
      
    let sqlStatement =  req.body.sql;

    try {
      const [results, metadata] = await sequelize.query(sqlStatement);      
      res.send(results);
    } catch (err) {
      if (err.sql !== undefined) {
        console.log('Error:',err.sql);
        return res.status(400).json({ message: err.sql });
      } else if (err.original !== undefined) {
        console.log('DB Connection Error:', err.original);
        return res.status(400).json({ message: err.original });
      } else  {
        console.log('Unknown Error:', err);
        return res.status(400).json({ message: err });
      }
    }
    
  });

  //*************************************************************
  app.post('/db/doesExist', async (req, res) => {
    // declared as a post as data is sent to this route as an object
      
    let sqlStatement =  'SELECT COUNT(*) AS x_count FROM ' + req.body.table + ' ' +
      req.body.condition;

    try {
      const [results, metadata] = await sequelize.query(sqlStatement);      
      res.send(results[0]);
    } catch (err) {
      if (err.sql !== undefined) {
        console.log('Error:',err.sql);
        return res.status(400).json({ message: err.sql });
      } else if (err.original !== undefined) {
        console.log('DB Connection Error:', err.original);
        return res.status(400).json({ message: err.original });
      } else  {
        console.log('Unknown Error:', err);
        return res.status(400).json({ message: err });
      }
    }
      
  });

  
  //*************************************************************
  app.post('/db/updateRecord', async (req, res) => {

    var sqlStatement = '';
    Object.keys(req.body.data).forEach((key) => {
      sqlStatement += (typeof req.body.data[key] === 'string') ? key + " = " + "'" + req.body.data[key].replace(/'/g, "''") + "'," : key + " = " + req.body.data[key] + ",";
    });
    sqlStatement = sqlStatement.slice(0, -1); 

    sqlStatement = "UPDATE " + req.body.table + " SET " + sqlStatement + " WHERE " + req.body.keyField + '=' + req.body.keyValue;    

    try {
      await sequelize.query(sqlStatement);      
      res.send({success: 1});
    } catch (err) {
      console.log('Error: ', sqlStatement);
      if (err.sql !== undefined) {
        console.log('Error:',err.sql);
        return res.status(400).json({ message: err.sql });
      } else if (err.original !== undefined) {
        console.log('DB Connection Error:', err.original);
        return res.status(400).json({ message: err.original });
      } else  {
        console.log('Unknown Error:', err);
        return res.status(400).json({ message: err });
      }
    }

  });

  //*************************************************************
  app.post('/db/insertRecord', async (req, res) => {

    // get call comma separated values, and trim off last comma
    let values_str = '';
    req.body.values.map((rec) => typeof rec === 'string' ? values_str += "'" + rec.replace(/'/g, "''") + "'"  + ',': values_str += rec + ',');    
    values_str = values_str.slice(0, -1); 
    
    let sqlStatement =  'INSERT INTO ' + req.body.table + ' (' +
      req.body.columns.join() + ') VALUES (' + values_str + ')';

    try {
      await sequelize.query(sqlStatement);      
      res.send({success: 1});
    } catch (err) {
      console.log('Error: ', sqlStatement);
      if (err.sql !== undefined) {
        console.log('Error:',err.sql);
        return res.status(400).json({ message: err.sql });
      } else if (err.original !== undefined) {
        console.log('DB Connection Error:', err.original);
        return res.status(400).json({ message: err.original });
      } else  {
        console.log('Unknown Error:', err);
        return res.status(400).json({ message: err });
      }
    }
    
  });

  //*************************************************************
  app.post('/db/deleteRecord', async (req, res) => {

    var sqlStatement = 'DELETE FROM ' + req.body.table + ' WHERE ' + req.body.keyField + '=' + req.body.keyValue;
      
    try {
      await sequelize.query(sqlStatement);      
      res.send({success: 1});
    } catch (err) {
      console.log('Error: ', sqlStatement);
      if (err.sql !== undefined) {
        console.log('Error:',err.sql);
        return res.status(400).json({ message: err.sql });
      } else if (err.original !== undefined) {
        console.log('DB Connection Error:', err.original);
        return res.status(400).json({ message: err.original });
      } else  {
        console.log('Unknown Error:', err);
        return res.status(400).json({ message: err });
      }
    }
  
  });

  //*************************************************************
  app.get('/db/getNextId/:tableName/:fieldName', async (req, res) => {

    const sqlStatement =           
      `SELECT MAX(${req.params.fieldName.trim()}) AS maxId 
       FROM ${req.params.tableName.trim()} `;

    try {
      const [results, metadata]  = await sequelize.query(sqlStatement);      
      var maxId = ((results.length === 0) || (results[0].maxId === undefined) || (results[0].maxId === null)) ? 1 : results[0].maxId + 1;
      res.send({maxId: maxId});
    } catch (err) {
      console.log('Error: ', sqlStatement);
      if (err.sql !== undefined) {
        console.log('Error:',err.sql);
        return res.status(400).json({ message: err.sql });
      } else if (err.original !== undefined) {
        console.log('DB Connection Error:', err.original);
        return res.status(400).json({ message: err.original });
      } else  {
        console.log('Unknown Error:', err);
        return res.status(400).json({ message: err });
      }
    }

  });


};

