/*=============================================================*/
/*=== setup all the database call routes =====================*/
/*=== The routes fetch data from the tables ==================*/
/*=============================================================*/

var sql = require('mssql');

module.exports = (app,db) => {

  //let pool = sql.connect(db.dbConfig);

  //const poolPromise = new sql.ConnectionPool(db.dbConfig)
  //  .connect()
  //  .then(pool => {
  //    console.log('Connected to MSSQL')
  //    return pool
  //  })
  //.catch(err => console.log('Database Connection Failed! Bad Config: ', err))

  //*************************************************************
  app.get('/db/getTest', async (req, res) => {
    res.send('test');
  });
  

  //*************************************************************
  app.get('/db/getCities', async (req, res) => {

    sql.connect(db.dbConfig).then( async() => {
      const res1 = await sql.query`select cities_id, citycode, city from cities order by city`;
      res.send(res1.recordset);
    }).catch((err) => {
      console.log(err);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })

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

    const qry = `SELECT AdmUsers_id, uid, SuperUser FROM admusers 
      WHERE uid='${req.params.username.trim()}'
      AND Pwd = '${req.params.pwd.trim()}'`;

    sql.connect(db.dbConfig).then( async() => {
      const res1 = await sql.query(`${qry}`);
      res.send(res1.recordset);
    }).catch((err) => {
      console.log(err);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })

  });

  //*************************************************************
  app.get('/db/getNextId/:tableName/:fieldName', async (req, res) => {

    const sqlStatement =           
      `SELECT MAX(${req.params.fieldName.trim()}) AS maxId 
       FROM ${req.params.tableName.trim()} `;

    sql.connect(db.dbConfig).then( async() => {
      const res1 = await sql.query (sqlStatement);
      var maxId = ((res1.recordset.length === 0) || (res1.recordset[0].maxId === undefined) || (res1.recordset[0].maxId === null)) ? 1 : res1.recordset[0].maxId + 1;
      res.send({maxId: maxId});
    }).catch((err) => {
      console.log(err);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })

  });


  //*************************************************************
  app.get('/db/getCurrencies', async (req, res) => {

    sql.connect(db.dbConfig).then( async() => {
      const res1 = await sql.query
        `SELECT c.* FROM Currencies c 
        ORDER BY c.CurrencyCode`;
      res.send(res1.recordset);
    }).catch((err) => {
      console.log(err);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })

  });

  //*************************************************************
  app.post('/db/executeSP', async (req, res) => {
    // declared as a post as data is sent to this route as an object
      
    let sqlStatement =  req.body.sql;

    sql.connect(db.dbConfig).then( async() => {
  
    const request = new sql.Request()
    //request.stream = true // You can set streaming differently for each request
    await request.query(sqlStatement)
      .then( async(res1) => {
        res.send(res1);
      })
  
    }).catch((err) => {
      console.log(err);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })
    
  });

  //*************************************************************
  app.post('/db/executeSP2', async (req, res) => {
    // declared as a post as data is sent to this route as an object
      
    let sqlStatement =  req.body.sql;
  

      sql.connect(db.dbConfig).then(pool => {
        return pool.request().query(sqlStatement);
      }).then(res1 => {
        console.log('2. into res1');
        res.send(res1.recordset);
      }).then(() => {
        sql.close;
      }).catch((err) => {
        console.log('==== Error ======');
        console.log(sqlStatement);
        const errorMessage = ((err.originalError !== undefined) &&
          (err.originalError.info !== undefined) &&
          (err.originalError.info.message !== undefined)) ? err.originalError.info.message : 'Backend Error';
        console.log(errorMessage);
        console.log(err);
        console.log('=================');
        console.log('');
        sql.close;
        return res.status(400).json({ message: errorMessage });
      })

    
    
  });


  //*************************************************************
  app.post('/db/doesExist', async (req, res) => {
    // declared as a post as data is sent to this route as an object
      
    let sqlStatement =  'SELECT COUNT(*) AS x_count FROM ' + req.body.table + ' ' +
      req.body.condition;

    sql.connect(db.dbConfig).then( async() => {
  
    const request = new sql.Request()
    //request.stream = true // You can set streaming differently for each request
    await request.query(sqlStatement)
      .then( async(res1) => {
        res.send(res1.recordset[0]);
      })
  
    }).catch((err) => {
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

    sql.connect(db.dbConfig).then( async() => {
  
    const request = new sql.Request()
    //request.stream = true // You can set streaming differently for each request
    await request.query(sqlStatement)
      .then( async(res1) => {
        res.send(res1.recordset);
      })
  
    }).catch((err) => {
      console.log(err);
      console.log(sqlStatement);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })
    
  });

  //*************************************************************
  app.post('/db/getRecord2', (req, res) => {
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

    let fileStr = (req.body.file !== undefined) ? req.body.file : '';

      sql.connect(db.dbConfig).then(pool => {
        console.log('1.  into pool', fileStr);
        console.log(sqlStatement);
        return pool.request().query(sqlStatement);
      }).then(res1 => {
        console.log('2. into res1');
        res.send(res1.recordset);
      }).then(() => {
        console.log('3. Close');
        console.log('');
        console.log('');
        sql.close;
      }).catch((err) => {
        console.log('==== Error ======');
        console.log(sqlStatement);
        const errorMessage = ((err.originalError !== undefined) &&
          (err.originalError.info !== undefined) &&
          (err.originalError.info.message !== undefined)) ? err.originalError.info.message : 'Backend Error';
        console.log(errorMessage);
        console.log(err);
        console.log('=================');
        console.log('');
        sql.close;
        return res.status(400).json({ message: errorMessage });
      })

    
  });
  
  //*************************************************************
{/*  
  app.post('/db/getRecord3', async (req, res) => {
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

    let fileStr = (req.body.file !== undefined) ? req.body.file : '';

    console.log('1.  into pool', fileStr);

    try {
      const pool1 = await poolPromise;
      const result = await pool1.request().query(sqlStatement);
      res.send(result.recordset)
    } catch (err) {
      console.log('==== Error ======');
      console.log(sqlStatement);
      const errorMessage = ((err.originalError !== undefined) &&
        (err.originalError.info !== undefined) &&
        (err.originalError.info.message !== undefined)) ? err.originalError.info.message : 'Backend Error';
        return res.status(400).json({ message: errorMessage });
    }
    
  });
*/}

  //*************************************************************
  app.post('/db/updateRecord', async (req, res) => {

    var sqlStatement = '';
    Object.keys(req.body.data).forEach((key) => {
      sqlStatement += (typeof req.body.data[key] === 'string') ? key + " = " + "'" + req.body.data[key].replace("'","''") + "'," : key + " = " + req.body.data[key] + ",";
    });
    sqlStatement = sqlStatement.slice(0, -1); 

    sqlStatement = "UPDATE " + req.body.table + " SET " + sqlStatement + " WHERE " + req.body.keyField + '=' + req.body.keyValue;    

    sql.connect(db.dbConfig).then( async() => {

      const request = new sql.Request()
      //request.stream = true // You can set streaming differently for each request
      request.query(sqlStatement)
      .then(() => {
        res.send({success: 1});
      })

    }).catch((err) => {
      console.log(err);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })

  });

  //*************************************************************
  app.post('/db/insertRecord', async (req, res) => {

    // get call comma separated values, and trim off last comma
    let values_str = '';
    req.body.values.map((rec) => typeof rec === 'string' ? values_str += "'" + rec + "'"  + ',': values_str += rec + ',');    
    values_str = values_str.slice(0, -1); 
    
    let sqlStatement =  'INSERT INTO ' + req.body.table + ' (' +
      req.body.columns.join() + ') VALUES (' + values_str + ')';

    sql.connect(db.dbConfig).then( async() => {

      const request = new sql.Request()
      //request.stream = true // You can set streaming differently for each request
      await request.query(sqlStatement)
      .then( async() => {
        await res.send({success: true});
      }).catch(async(err) => {
        console.log(err);
        await res.send({success: false});
      })

    }).catch((err) => {
      console.log(err);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })
  
  });

  //*************************************************************
  app.post('/db/deleteRecord', async (req, res) => {

    var sqlStatement = 'DELETE FROM ' + req.body.table + ' WHERE ' + req.body.keyField + '=' + req.body.keyValue;

    sql.connect(db.dbConfig).then( async() => {

      const request = new sql.Request()
      //request.stream = true // You can set streaming differently for each request
      request.query(sqlStatement)
      .then(() => {
        res.send({success: true});
      })

    }).catch((err) => {
      console.log(err);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })

  });


  //*************************************************************
  app.get('/db/getCountries', async (req, res) => {

    sql.connect(db.dbConfig).then( async() => {
      const res1 = await sql.query
        `SELECT * FROM Countries c
        ORDER BY c.country`;
      res.send(res1.recordset);
    }).catch((err) => {
      console.log(err);
      const errorMessage = ((err.original !== undefined) && (err.original.sqlMessage !== undefined)) ? err.original.sqlMessage : 'Backend Error';
      return res.status(400).json({ message: errorMessage });
    })

  });


};

