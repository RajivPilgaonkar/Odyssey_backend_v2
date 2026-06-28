/*=============================================================*/
/*=== setup all the database call routes =====================*/
/*=== The routes fetch data from the tables ==================*/
/*=== Parts, Categories, Chapters, Lessons, Users ============*/
/*=============================================================*/
const docx = require("docx");
var fs = require('fs');
const path = require('path');

module.exports = (app,db,sequelize) => {

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/welcomeLetter', async (req, res) => {

    //let docFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/welcomeLetter.docx';
    let docFile = 'presto/welcomeLetter.docx';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    let docObj = {doc: null, docx: docx};
    const welcomeLetter = require('./prestoWelcomeLetter');
    await welcomeLetter.getWelcomeLetter(req, res, sequelize, docObj);

    await docx.Packer.toBuffer(docObj.doc).then((buffer) => {
      fs.writeFileSync(docFile, buffer);
    });

    saveDocx(docFile, req, res);

  });

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/driversItinerary', async (req, res) => {

    //let docFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/welcomeLetter.docx';
    let docFile = 'presto/driversItinerary.docx';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    let docObj = {doc: null, docx: docx};
    const welcomeLetter = require('./prestoDriversItinerary');
    await welcomeLetter.getDriversItinerary(req, res, sequelize, docObj);

    await docx.Packer.toBuffer(docObj.doc).then((buffer) => {
      fs.writeFileSync(docFile, buffer);
    });

    saveDocx(docFile, req, res);

  });
  
  /*==============================================*/  
  function saveDocx(docFile, req, res) {

    try {

      // option to download pdf
      const downloadPdf = (req.body.data.downloadPdf === undefined || req.body.data.downloadPdf) ? true : false;

      if (downloadPdf) {
        // Sending a PDF file and NOT the default json file
        let stream = fs.createReadStream(docFile);
        res.setHeader('Content-Disposition', 'attachment; filename=' + docFile);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessing');
        stream.pipe(res);
      } else {
        res.json({success: true});
      }

    } catch(e) {
      res.json({success: false});
    }

  }
  
};
