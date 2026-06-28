/*=============================================================*/
/*=== setup all the database call routes =====================*/
/*=== The routes fetch data from the tables ==================*/
/*=== Parts, Categories, Chapters, Lessons, Users ============*/
/*=============================================================*/
var PDFDocument = require('pdfkit');
var fs = require('fs');
var moment = require('moment');

module.exports = (app,db,sequelize) => {

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/basicItinerary', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36}
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/basicItinerary.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const itin = require('./prestoItinerary');
    await itin.getBasicItinerary(req, res, sequelize, doc, fs, pdfFile, false);

    savePdf(pdfFile, req, res, doc);


  });

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/detailedItinerary', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36}
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/detailedItinerary.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const itin = require('./prestoDetailedItinerary');
    await itin.getDetailedItinerary(req, res, sequelize, doc, fs, pdfFile, false);

    savePdf(pdfFile, req, res, doc);

  });

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/inclusions', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36}
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/inclusions.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const itin = require('./prestoInclusions');
    await itin.getInclusions(req, res, sequelize, doc, fs, pdfFile, false);

    savePdf(pdfFile, req, res, doc);

  });

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/exclusions', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36}
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/exclusions.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const itin = require('./prestoExclusions');
    await itin.getExclusions(req, res, sequelize, doc, fs, pdfFile, false);

    savePdf(pdfFile, req, res, doc);

  });

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/hotelsAgents', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36}
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/hotelsAgents.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const itin = require('./prestoHotelsAgents');
    await itin.getHotelsAgents(req, res, sequelize, doc, fs, pdfFile, false);

    savePdf(pdfFile, req, res, doc);

  });

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/composite', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36}
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/exclusions.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const comp = require('./prestoComposite');
    await comp.getComposite(req, res, sequelize, doc, fs, pdfFile, true);

    const itin = require('./prestoItinerary');
    await itin.getBasicItinerary(req, res, sequelize, doc, fs, pdfFile, true);

    const incl = require('./prestoInclusions');
    await incl.getInclusions(req, res, sequelize, doc, fs, pdfFile, true);

    const excl = require('./prestoExclusions');
    await excl.getExclusions(req, res, sequelize, doc, fs, pdfFile, true);

    const compFooter = require('./prestoComposite');
    await compFooter.getCompositeFooter(req, res, sequelize, doc, fs, pdfFile, true);

    savePdf(pdfFile, req, res, doc);

  });

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/driversItineraryPdf', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36}
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/driversItinerary.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const itin = require('./prestoDriversItinerary');
    await itin.getDriversItinerary(req, res, sequelize, doc, fs, pdfFile, false);

    savePdf(pdfFile, req, res, doc);

  });

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/welcomeLetterPdf', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36}
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/welcomeLetter.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const itin = require('./prestoWelcomeLetter');
    await itin.getWelcomeLetter(req, res, sequelize, doc, fs, pdfFile, false);

    savePdf(pdfFile, req, res, doc);

  });

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/pagingBoard', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36},
      layout : 'landscape'
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/pagingBoard.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const itin = require('./prestoPagingBoard');
    await itin.getPagingBoard(req, res, sequelize, doc, fs, pdfFile, false);

    savePdf(pdfFile, req, res, doc);

  });


  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/tourHotelsAgents', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36},
      layout : 'landscape'
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/tourHotelAgents.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const itin = require('./prestoTourHotelsAgents');
    await itin.getTourHotelsAgents(req, res, sequelize, doc, fs, pdfFile, false);

    savePdf(pdfFile, req, res, doc);

  });

  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/hotelImages', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36}
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/hotelImages.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const hotel = require('./prestoHotelImages');
    await hotel.getHotelImages(req, res, sequelize, doc, fs, pdfFile, false);

    savePdf(pdfFile, req, res, doc);

  });


  /*=== route to print voucher reports ===*/  
  app.post('/reports/presto/prestoTest', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36}
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'presto/' + req.body.data.fileName :  'presto/test.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './presto';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create presto directory" });
      });
    }

    const test = require('./prestoTest');
    await test.getTest(req, res, sequelize, doc, fs, pdfFile, false);

    savePdf(pdfFile, req, res, doc);

  });


  /*==============================================*/  
  function savePdf(pdfFile, req, res, doc) {

    try {
      doc.save();
      doc.end();

      // option to download pdf
      const downloadPdf = (req.body.data.downloadPdf === undefined || req.body.data.downloadPdf) ? true : false;

      if (downloadPdf) {

        // Sending a PDF file and NOT the default json file
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=' + pdfFile);
        doc.pipe(res);      

      } else {
        return res.json({success: true});
      }

    } catch(e) {
      return res.json({success: false});
    }

  }



};
