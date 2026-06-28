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
  app.post('/reports/vouchers', async (req, res) => {

    const fromVoucher = (req.body.data.voucherRange === null) ? 'null' : req.body.data.voucherRange[0].toString();
    const toVoucher = (req.body.data.voucherRange === null) ? 'null' : req.body.data.voucherRange[1].toString();
    const yearRef= (req.body.data.yearRef === null) ? 'null' : req.body.data.yearRef.toString();

    /*=== if only from a single organistaion (such as when mailing vouchers) ===*/
    let addressbookStr = '';
    if (req.body.data.addressbook_id !== null) {
      addressbookStr = ' AND addressbook_id = ' + req.body.data.addressbook_id.toString() + ' ';
    }

    /*=== get voucher info to print ===*/  
    var vouchers = await sequelize.query(
      "SELECT * FROM [dbo].[fn_Rpt_PrintVouchers] ('" + req.body.data.tourCode + "', '" + 
        req.body.data.tourDate + "'," +
        fromVoucher + "," + toVoucher + "," + yearRef + ",1) " +
        " WHERE (1=1) " + addressbookStr, {})
      .catch(function (err) {
        return res.status(400).json({ message: "error while trying to get vouchers " });
      });

    /*=== filter on vouchers requested ===*/  
    if (req.body.data.vouchers !== null) {
      vouchers[0] = vouchers[0].filter(rec => req.body.data.vouchers.includes(rec.Voucherno));      
    }

    /*=== get company info for Odyssey Tours & Travels ===*/  
    var companies = await sequelize.query(
      "SELECT organisation, address, city, postalcode, phone, fax, email FROM addressbook " + 
      " WHERE addressbook_id = 68", {})
      .catch(function (err) {
        return res.status(400).json({ message: "error while trying to get company data " });
      });

    /*=== If reportType = 1, print on 6 inch label height (without logo) ===*/
    /*=== If reportType = 2, print on regular size page but 2 per page (without logo) ===*/
    /*=== If reportType = 3, print on regular size page but 1 per page (with logo) ===*/
    /*=== 1 inch = 72 units in PDFkit, so 4 inches = 432 units for page height ===*/
    /*=== ... Page height is used only for reportType 1 (label) ===*/
    const reportPageHeight = 432;
    const fontSize = 12;
    const labelPosX = [350,440];
    const reportType = req.body.data.reportType;

    /*=== create Pdf doc with page size and margins ===*/  
    var doc = new PDFDocument({ 
      size: (reportType === 1) ? [612,reportPageHeight] : null,
      margins : {top: 36, bottom:18, left: 36, right: 36}
     });

    try {

      /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
      var dir = './vouchers';

      /*=== create directory if it does not exist ===*/    
      if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, function(err) {
          return res.status(400).json({ message: "could not create vouchers directory" });
        });
      }

      /*=== pdf file name ===*/    
      let addressbookSuffix = '';
      if (req.body.data.addressbook_id !== null) {
        addressbookSuffix = '_' + req.body.data.addressbook_id.toString();
      }      
            
      //let pdfFile = 'vouchers/voucher_' + voucherTypesSuffix + req.body.data.tourCode + addressbookSuffix + '.pdf';
      let pdfFile = 'vouchers/' + req.body.data.fileName;

      doc.pipe(fs.createWriteStream(pdfFile));

      /*=== loop through all vouchers for the tour ===*/    
      let count = 0;
      vouchers[0].forEach(function (record) {

        x_pos_left = 36;
        y_pos = doc.y;
        y_pos_top = y_pos;

        if (reportType === 3) {
          doc.moveDown(2);
        }

        // logo
        x_pos = x_pos_left + 350;
        y_pos = doc.y;
        if (reportType === 3) {
          doc.image('img/OdyToursLogo.png', x_pos, y_pos, {width: 160, height: 80});
        }

        /*=== for debugging (draw line at half page 6 inches) ===*/        
        //if ((reportType === 2) && (count%2 === 0)) {
        //  doc.moveTo(0,reportPageHeight);
        //  doc.lineTo(30,reportPageHeight);  
        //  doc.lineTo(100,reportPageHeight);
        //  doc.stroke();  
        //}

        //doc.moveDown(1);
        doc.fontSize(12).font('Courier');
        x_pos = x_pos_left;
        doc.text(record.Organisation, x_pos, y_pos, {align: 'left'} );      

        if (record.Address !== null) {
          doc.moveDown(1);
          doc.fontSize(fontSize).font('Courier');
          let address = record.Address.replace(/\r\n|\r/g, '\n');
          address = address.replace(/\n\n/g, '\n');
          address = address.replace(/\n\n/g, '\n');
          doc.text(address, {align: 'left'} );
        }

        doc.moveDown(0.5);
        doc.fontSize(fontSize).font('Courier-Bold');
        x_pos = doc.x;
        y_pos = doc.y;
        doc.text('Client', {align: 'left', width: 300} );

        doc.fontSize(fontSize).font('Courier');
        x_pos = x_pos_left+10;
        y_pos = doc.y;
        doc.text(record.TourRef, x_pos, y_pos, {} );

        doc.fontSize(fontSize).font('Courier-Bold');
        x_pos = x_pos_left+20;
        doc.text('  (' + record.Pax + ' Pax)', x_pos+60, y_pos, {} );

        doc.fontSize(fontSize).font('Courier');
        x_pos = x_pos_left+10;
        y_pos = doc.y;
        doc.text(record.TourLeader, x_pos, y_pos, {} );

        doc.fontSize(fontSize).font('Courier-Bold');
        x_pos = x_pos_left + labelPosX[0];
        doc.text('Voucher No: ', x_pos, y_pos);

        doc.fontSize(fontSize).font('Courier');
        x_pos = x_pos_left + labelPosX[1];
        doc.text(record.Voucherno, x_pos, y_pos, {});

        doc.moveDown(0.5);
        doc.fontSize(fontSize).font('Courier-Bold');
        x_pos = x_pos_left;
        y_pos = doc.y;
        doc.text(record.ThroughAgent, x_pos, y_pos, {align: 'center'} );

        doc.moveDown(0.5);
        doc.fontSize(fontSize).font('Courier-Bold');
        x_pos = x_pos_left;
        y_pos = doc.y;
        doc.text('Valid For', x_pos, y_pos, {align: 'left', width: 300} );

        if (record.Description !== null) {
          doc.fontSize(fontSize).font('Courier');
          x_pos = doc.x+10;
          y_pos = doc.y;
          doc.text(record.Description.replace(/\r\n|\r/g, '\n'), x_pos, y_pos, {} );
        }

        if (record.Remarks1 !== null) {
          doc.moveDown(0.5);
          doc.fontSize(fontSize).font('Courier');
          y_pos = doc.y;
          doc.text(record.Remarks1.replace(/\r\n|\r/g, '\n'), x_pos, y_pos, {} );  
        }

        doc.moveDown(1);
        y_pos = doc.y;
        doc.text(record.HotelAgentRemark, x_pos, y_pos, {align: 'left', width: 300} )

        doc.fontSize(fontSize).font('Courier-Bold');
        x_pos = x_pos_left + labelPosX[0];
        doc.text('Issued By:  ', x_pos, y_pos, {} );

        doc.fontSize(fontSize).font('Courier');
        x_pos = x_pos_left + labelPosX[1];
        doc.text(record.Issuedby, x_pos, y_pos, {});
   
        doc.moveDown(0.1);
        doc.fontSize(fontSize).font('Courier-Bold');
        x_pos = x_pos_left + labelPosX[0];
        y_pos = doc.y;
        doc.text('Issued On:  ', x_pos, y_pos, {} );

        doc.fontSize(fontSize).font('Courier');
        x_pos = x_pos_left + labelPosX[1];
        doc.text(formatDate_DMY(record.Issuedon), x_pos, y_pos, {});

        if (reportType === 3) {
          doc.moveDown(1);
          doc.fontSize(fontSize-2).font('Courier-Bold');
          x_pos = x_pos_left + 10;
          y_pos = doc.y;
          doc.text('Bill us for the above services and collect all extras directly', x_pos, y_pos, {} );

          doc.moveDown(1);

          // iata logo
          x_pos = x_pos_left + 350;
          y_pos = doc.y;
          doc.image('img/IataLogo.png', x_pos, y_pos, {width: 160, height: 40});

          if (companies.length > 0 && companies[0].length > 0) {
            const company = companies[0][0];
            doc.fontSize(fontSize-2).font('Courier-Bold');
            x_pos = x_pos_left + 10;
            doc.text(company.organisation, x_pos, y_pos, {width: 300} );
            doc.text(company.address.replace(/\r\n|\r/g, '\n') + ', ' + company.city + ', ' + company.postalcode, {width: 300} );
            doc.text('Tel: ' + company.phone, {width: 300} );
            doc.text('Fax: ' + company.fax, {width: 300} );
            doc.text('Email: ' + company.email, {width: 300} );  
          }

        }

        count++;
        const even = (count%2 === 0);

        /*=== label printing for client (each label is half a page) ===*/    
        if ((reportType === 1) && (count < vouchers[0].length)) {
          doc.addPage();
        /*=== Print 2 vouchers per page ===*/    
        } else if ((reportType === 2) && (count < vouchers[0].length)) {
          if (!even) {
            //Write a blank at the end of half a page (6 inches from 1st line)
            doc.text('',x_pos_left,reportPageHeight+y_pos_top);      
            //doc.moveDown(0.5);
          } else {
            if (count < vouchers[0].length) {
              doc.addPage();
            }
          }
        /*=== Print with electronic logo (hotel copy) ===*/    
        } else if ((reportType === 3) && (count < vouchers[0].length)) {
          doc.addPage();
        } 

      });

      doc.save();

      doc.end();

      // option to download pdf
      const downloadPdf = (req.body.data.downloadPdf === undefined || req.body.data.downloadPdf) ? true : false;

      if (downloadPdf) {
        // Sending a PDF file and NOT the default json file
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=' + pdfFile);
        doc.pipe(res);      

        //*** Important Comments ***/
        //If the above code ever gives problems that it saves ...
        //... on the node server but does not download, consider ...
        //... switching to the code in VoucherServicesRoutes as below
        //... and also wrapping the code after 'end' within stream.on('finish')
        //const fileStream = fs.createReadStream(pdfFile);
        //fileStream.pipe(res);


      } else {
        res.json({success: true});
      }

  } catch(e) {
    res.json({success: false});
  }

  });

  function formatDate(x) {
    return moment(x).format('ll');
  }

  function formatDate_DMY(x) {
    return moment(x).format('DD/MM/YYYY');
  }

  function formatNumberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }


};
