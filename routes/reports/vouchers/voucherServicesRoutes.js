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
  app.post('/reports/vouchers/voucherServices', async (req, res) => {

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      margins : {top: 36, bottom:18, left: 36, right: 36}
    });

    let pdfFile = (req.body.data.fileName !== undefined) ? 'vouchers/' + req.body.data.fileName :  'vouchers/voucherServices.pdf';

    /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
    var dir = './vouchers';

    /*=== create directory if it does not exist ===*/    
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, function(err) {
        return res.status(400).json({ message: "could not create vouchers directory" });
      });
    }

    const itin = require('./voucherServices');

    // This will save the file to the vouchers folder in the backend, from where it wil be emailed
    const stream = doc.pipe(fs.createWriteStream(pdfFile));      

    await itin.getVoucherServices(req, res, sequelize, doc, fs);

    savePdf(pdfFile, req, res, doc, stream);

  });


  /*==============================================*/  
  function savePdf(pdfFile, req, res, doc, stream) {

    try {
      doc.save();
      doc.end();

      stream.on('finish', () => {

      // option to download pdf
      const downloadPdf = (req.body.data.downloadPdf === undefined || req.body.data.downloadPdf) ? true : false;

      if (downloadPdf) {

        // Sending a PDF file and NOT the default json file
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=' + pdfFile);
        //doc.pipe(res);      

        const fileStream = fs.createReadStream(pdfFile);
        fileStream.pipe(res);

      } else {
        res.json({success: true});
      }

      })

    } catch(e) {
      res.json({success: false});
    }

  }  

};
