const { Connection, Request, TYPES } = require('tedious');

const config = {
  server: 'localhost',
  authentication: {
    type: 'default',
    options: {
      userName: 'sa',
      password: 'sa123@pwd'
    }
  },
  options: {
    port: 1433, // Default Port
    database: 'Jadoo_2006',
    encrypt: false
  }
};

const connection = new Connection(config);

connection.connect(function(err) {
  if (err) {
    console.log('Connection Failed!');
    throw err;
  }

  executeQuery();
});

// Creating new table called [dbo].[test_param]
//--------------------------------------------------------------------------------
function executeQuery() {
  const sql = `SELECT cities_id FROM cities`;
  const request = new Request(sql, async (err, rowCount) => {
    if (err) {
      throw err;
    }
    //console.log(`query prepared`, rowCount, request);
    
  });

  request.on('row', function(columns) {  
    console.log(columns);  
    result ="";  
});  

  res = connection.execSql(request);
  console.log(res);

}

