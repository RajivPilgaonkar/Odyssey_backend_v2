const imgHelper = require("../imgHelper");

async function getDetailedItinerary (req, res, sequelize, doc, fs, pdfFile, isComposite) {

  const quoPrint_id = (req.body.data.quoPrint_id === undefined) ? 6163 : req.body.data.quoPrint_id;
  const quotations_id = (req.body.data.quotations_id === undefined) ? 8125 : req.body.data.quotations_id;

  /*=== get voucher info to print ===*/  
  var headerData = await sequelize.query(
    "SELECT p.PaxInfo, p.StartingInfo, p.EndingInfo, p.BookingInfo " + 
      " FROM QuoPrint p " +
      " WHERE p.QuoPrint_id = " + quoPrint_id.toString(),{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get composite report data " });
    });

  /*=== get voucher info to print ===*/  
  var detailData = await sequelize.query(
    "SELECT d.QuoPrintDays_id, d.SrNo, d.DayInfo, d.DaySummaryInfo " + 
      " FROM QuoPrintDays d " +
      " WHERE d.QuoPrint_id = " + quoPrint_id.toString() + " " +
      " ORDER BY d.SrNo ",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get composite report data details " });
    });

  /*=== get voucher info to print ===*/  
  var subDetailData = await sequelize.query(
    "SELECT QuoPrintDays_id, SrNo, Place, PlaceInfo FROM QuoPrintPlaces " +
    "WHERE QuoPrintDays_id IN (SELECT QuoPrintDays_id FROM QuoPrintDays " + 
    "WHERE QuoPrint_id = " +  quoPrint_id.toString() + ") " +
    "ORDER BY QuoPrintDays_id, SrNo" ,{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get composite report data sub-details " });
    });

  const fontSize = 12;
  const detailFontSize = 10;

  const displayImages = req.body.data.img;
  var imgData = [];
  if (displayImages) {
    /*=== get voucher info to print ===*/  
    imgData = await sequelize.query(
      "EXEC p_QuoStateImageListNode " + quotations_id.toString(),{})
      .catch(function (err) {
        return res.status(400).json({ message: "error while trying to get composite report data sub-details " });
      });
  }

  /*=== Header ===*/
  var x_pos_left = 36;
  var y_pos = doc.y;
  var x_pos = x_pos_left;

  try {

    //if (!isComposite) {
    //  doc.pipe(fs.createWriteStream(pdfFile));
    //}

    /*=== Detailed Itinerary with Images ===*/
    if (displayImages) {

      y_pos = 5;

      if (imgData.length < 2) {
        doc.image('img/presto/PrestoTop.jpg', x_pos, y_pos, {width: doc.page.width - doc.page.margins.right - doc.page.margins.left});    
        y_pos = doc.y;
        doc.moveDown(12);  
      } else {

        /*=== Max 2 images side by side ===*/
        const imgArray = imgData[0].slice(0, 2);
        const halfWidth = (doc.page.width - doc.page.margins.right - doc.page.margins.left)/2;

        for (var i=0; i<imgArray.length; i++) {
          var imgPath = imgArray[i].ImageName.replace(/\\/g, '/');
          const img = await imgHelper.fetchImage(imgPath);
          if (img !== null) {
            doc.image(img, x_pos + i*halfWidth, y_pos, {width: halfWidth-2});    
          }
        }

        doc.moveDown(12);  
        y_pos = doc.y;

      }
    }

    doc.fontSize(14).font('font/Calibri Bold.ttf');
    doc.text('Detailed Itinerary:', x_pos, y_pos, {align: 'left'} );      
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
      doc.text(headerData[0][0].BookingInfo, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.5);

      // Draw horizontal line
      y_pos = doc.y;
      doc.moveTo(x_pos_left, y_pos);
      doc.lineTo(doc.page.width - doc.page.margins.right,y_pos);  
      doc.lineWidth(1);
      doc.stroke();  

      doc.moveDown(1);
    }

    /*=== loop through all vouchers for the tour ===*/    
    detailData[0].forEach(function (record,index) {

      x_pos_left = 36;
      y_pos = doc.y;
      y_pos_top = y_pos;

      //doc.moveDown(1);

      doc.rect(x_pos_left, y_pos, doc.page.width - doc.page.margins.right - doc.page.margins.left, 15).fillAndStroke('#cce6ff', '#cce6ff');
      doc.fill('#000').stroke();
      
      doc.moveDown(0.1);
      doc.fontSize(14).font('font/Calibri Bold.ttf');
      x_pos = x_pos_left;
      y_pos = doc.y;
      doc.text(record.DayInfo, x_pos, y_pos, {align: 'left'} );      

      doc.moveDown(0.1);

      doc.fontSize(detailFontSize).font('font/Calibri Bold Italic.ttf');
      x_pos = x_pos_left;
      y_pos = doc.y;
      doc.text(record.DaySummaryInfo, x_pos, y_pos, {align: 'left'} );      

      doc.moveDown(1);

      var filterData = subDetailData[0].filter(rec => rec.QuoPrintDays_id === record.QuoPrintDays_id);
  
      filterData.forEach(function (subDetailRecord) {

        if (doc.y > 0.85*(doc.page.height - doc.page.margins.bottom)) {
          if (index < detailData[0].length-1) {
            doc.addPage();
          }
        }
  
        doc.fontSize(detailFontSize).font('font/Calibri Bold.ttf');
        x_pos = x_pos_left;
        y_pos = doc.y;
        doc.text(subDetailRecord.Place, x_pos, y_pos, {align: 'left'} );                  

        doc.moveDown(0.1);

        doc.fontSize(detailFontSize).font('font/Calibri Regular.ttf');
        x_pos = x_pos_left;
        y_pos = doc.y;
        doc.text(subDetailRecord.PlaceInfo, x_pos, y_pos, {align: 'left'} );                  

        doc.moveDown(1);

      });

      if (doc.y > 0.85*(doc.page.height - doc.page.margins.bottom)) {
        if (index < detailData[0].length-1) {
          doc.addPage();
        }
      }
      
    });

  } catch(e) {
    res.json({success: false});
  }

}

module.exports = { getDetailedItinerary };


