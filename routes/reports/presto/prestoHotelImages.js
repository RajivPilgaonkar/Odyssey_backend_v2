const imgHelper = require("../imgHelper");

async function getHotelImages (req, res, sequelize, doc, fs, pdfFile, isComposite) {

  const quoPrint_id = (req.body.data.quoPrint_id === undefined) ? 6163 : req.body.data.quoPrint_id;
  const quotations_id = (req.body.data.quotations_id === undefined) ? 8125 : req.body.data.quotations_id;

  /*=== get voucher info to print ===*/  
  var headerData = await sequelize.query(
    "SELECT p.PaxInfo, p.StartingInfo, p.EndingInfo " + 
      " FROM QuoPrint p " +
      " WHERE p.QuoPrint_id = " + quoPrint_id.toString(),{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get composite report data " });
    });

  /*=== quotation data ===*/  
  var quoData = await sequelize.query(
    "SELECT q.NumPax, q.TourCode " + 
      " FROM Quotations q " +
      " WHERE q.Quotations_id = " + quotations_id.toString(),{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get quotations data " });
    });

  /*=== get voucher info to print ===*/  
  var detailData = await sequelize.query(
    "EXEC p_Rpt_QuoTourHotelImgList " + quotations_id.toString() + ",1 ",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get composite report data details " });
    });

  /*=== get company info for Odyssey Tours & Travels ===*/  
  var companies = await sequelize.query(
    "SELECT organisation, address, city, postalcode, phone, fax, email FROM addressbook " + 
    " WHERE addressbook_id = 68", {})
      .catch(function (err) {
        return res.status(400).json({ message: "error while trying to get company data " });
    });

  const fontSize = 12;
  const detailFontSize = 10;

  /*=== Header ===*/
  var x_pos_left = 36;
  var y_pos = doc.y;
  var x_pos = x_pos_left;

  try {

    //if (!isComposite) {
    //  doc.pipe(fs.createWriteStream(pdfFile));
    //}

    /*=== Hotel Listing with Images ===*/
    y_pos = 5;

    doc.image('img/presto/HotelTop.jpg', x_pos, y_pos, {width: doc.page.width - doc.page.margins.right - doc.page.margins.left});    
    y_pos = doc.y;
    doc.moveDown(12);  

    y_pos = doc.y;
    doc.fontSize(14).font('font/Calibri Bold.ttf');
    doc.text('List of Hotels:', x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.5);
    y_pos = doc.y;

    if (!isComposite) {
      doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
      y_pos = doc.y;
      doc.text(headerData[0][0].PaxInfo, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.3);
      y_pos = doc.y;
      doc.text(headerData[0][0].StartingInfo, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.3);
      y_pos = doc.y;
      doc.text(headerData[0][0].EndingInfo, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.5);
      y_pos = doc.y;
      doc.text('Tour Code:' + quoData[0][0].TourCode, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.5);

      // Draw horizontal line
      y_pos = doc.y;
      doc.moveTo(x_pos_left, y_pos);
      doc.lineTo(doc.page.width - doc.page.margins.right,y_pos);  
      doc.lineWidth(1);
      doc.stroke();  

      doc.moveDown(3);
    }

    /*=== loop through all vouchers for the tour ===*/        
    for (const [index, record] of detailData[0].entries()) {
      x_pos_left = 36;
      y_pos = doc.y;
      y_pos_top = y_pos;

      doc.fontSize(fontSize).font('font/Calibri Bold Italic.ttf');
      x_pos = x_pos_left;
      y_pos = doc.y;
      doc.text(record.City, x_pos, y_pos, {align: 'left'} );      

      var halfWidth = (doc.page.width - doc.page.margins.right)/2
      x_pos = x_pos_left + halfWidth;
      doc.text(record.Hotel, x_pos, y_pos, {align: 'left'} );      

      doc.moveDown(1);

      doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
      x_pos = x_pos_left;
      y_pos = doc.y;
      if (record.ImagePath !== null) {        
        var imgPath = record.ImagePath.replace(/\\/g, '/');
        const img = await imgHelper.fetchImage(imgPath);
        if (img !== null) {
          doc.image(img, x_pos, y_pos, {width: halfWidth/2});    
        }
      }
  
      x_pos = x_pos_left + halfWidth;
      var field = record.HotelAddress;
      if (field !== null) {
        field = field.replace(/\r\n|\r/g, '\n');
      }
      doc.text(field, x_pos, y_pos, {align: 'left', width: halfWidth-5});                

      y_pos = y_pos + halfWidth/3;
      doc.y = y_pos;
      doc.moveDown(1);

      y_pos = doc.y;
      doc.fillColor('#000000',0.2);
      doc.strokeColor('#000000',0.2);
      doc.moveTo(x_pos_left, y_pos);  
      doc.lineTo(doc.page.width - doc.page.margins.right,y_pos);  
      doc.lineWidth(1);
      doc.stroke();  

      doc.fillColor('#000000',1);
      doc.strokeColor('#000000',1);

      doc.y = y_pos;
      doc.moveDown(1);
      y_pos = doc.y;

      if (doc.y > 0.80*(doc.page.height - doc.page.margins.bottom)) {
        if (index < detailData[0].length-1) {
          doc.addPage();
        }
      }

    }

    
    doc.moveDown(4);
    y_pos = doc.y;

    const width = doc.page.width - doc.page.margins.right - doc.page.margins.left;

    if (companies.length > 0 && companies[0].length > 0) {

      if (doc.y > 0.60*(doc.page.height - doc.page.margins.bottom)) {
        doc.addPage();
        y_pos = doc.page.margins.top;
      }

      const company = companies[0][0];
      doc.fontSize(14).font('font/Calibri Bold.ttf');
      x_pos = x_pos_left + 10;
      doc.text(company.organisation, x_pos, y_pos, {width: width, align: 'center'} );

      doc.fontSize(12).font('font/Calibri Regular.ttf');
      doc.text(company.address.replace(/\r\n|\r/g, '\n') + ', ' + company.city + ', ' + company.postalcode, {width: width, align: 'center'} );
      doc.text('Tel: ' + company.phone, {width: width, align: 'center'} );
      doc.text('Fax: ' + company.fax, {width: width, align: 'center'} );
      doc.text('Email: ' + company.email, {width: width, align: 'center'} );        

      doc.moveDown(2);
      var y_pos = doc.y;
  
      doc.image('img/presto/HotelBottom.jpg', x_pos, y_pos, {width: doc.page.width - doc.page.margins.right - doc.page.margins.left});    
      var y_pos = doc.y;
      doc.moveDown(1);
  
    }


  } catch(e) {
    res.json({success: false});
  }

}

module.exports = { getHotelImages };


