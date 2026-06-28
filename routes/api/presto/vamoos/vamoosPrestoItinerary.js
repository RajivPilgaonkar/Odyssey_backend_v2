module.exports = (app,db,sequelize) => {

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/vamoosAPI', async (req, res) => {

    console.log('req',req.body.data);

  });


};
