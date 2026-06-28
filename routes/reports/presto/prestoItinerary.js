async function getBasicItinerary (req, res, sequelize, doc, fs, pdfFile, isComposite) {

  const quoPrint_id = (req.body.data.quoPrint_id === undefined) ? 6163 : req.body.data.quoPrint_id;
  const subType = (req.body.data.reportSubType === undefined) ? 1 : req.body.data.reportSubType;

  /*=== get voucher info to print ===*/  
  var headerData = await sequelize.query(
    "SELECT p.PaxInfo, p.StartingInfo, p.EndingInfo, p.QuoEstimateText " + 
      " FROM QuoPrint p " +
      " WHERE p.QuoPrint_id = " + quoPrint_id.toString(),{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get composite report data " });
    });

  /*=== get voucher info to print ===*/  
  var detailData = await sequelize.query(
    "SELECT d.SrNo, d.DayInfo, d.DaySummaryInfo " + 
      " FROM QuoPrintItineraries d " +
      " WHERE d.QuoPrint_id = " + quoPrint_id.toString() + " " +
      " ORDER BY d.SrNo ",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get composite report data details " });
    });

  const fontSize = 12;
  
  try {

    //if (!isComposite) {
    //  doc.pipe(fs.createWriteStream(pdfFile));
    //}

    /*=== Header ===*/
    var x_pos_left = 36;
    var y_pos = doc.y;
    var x_pos = x_pos_left;

    doc.fontSize(14).font('font/Calibri Bold.ttf');
    doc.text('Itinerary:', x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.5);

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
  
      // Draw horizontal line
      if (subType === 1) {
        y_pos = doc.y;
        doc.moveTo(x_pos_left, y_pos);
        doc.lineTo(doc.page.width - doc.page.margins.right,y_pos);  
        doc.lineWidth(1);
        doc.stroke();  
      }
  
      doc.moveDown(1);
  
    }

    /*=== loop through all vouchers for the tour ===*/    
    detailData[0].forEach(function (record) {

      x_pos_left = 36;
      y_pos = doc.y;
      y_pos_top = y_pos;

      //doc.moveDown(1);
      doc.fontSize(fontSize).font('font/Calibri Bold.ttf');
      x_pos = x_pos_left;
      y_pos = doc.y;
      doc.text(record.DayInfo, x_pos, y_pos, {align: 'left'} );      

      doc.moveDown(0.1);

      doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
      x_pos = x_pos_left;
      y_pos = doc.y;
      var field = record.DaySummaryInfo;
      if (field !== null) {
        field = field.replace(/\r\n|\r/g, '\n');
      }
      doc.text(field, x_pos, y_pos, {align: 'left'} );      

      doc.moveDown(1);
      
    });


    // Add Quotation Estimate
    if (isComposite && headerData[0][0].QuoEstimateText !== null && headerData[0][0].QuoEstimateText.trim() !== '') {

      doc.fillColor('#000000',0.2);
      doc.strokeColor('#000000',0.2);
  
      // Draw horizontal line
      if (subType === 1) {
        doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
        y_pos = doc.y;
        doc.moveTo(x_pos_left, y_pos);
        doc.lineTo(doc.page.width - doc.page.margins.right,y_pos);  
        doc.lineWidth(1);
        doc.stroke();  
      }

      doc.fillColor('#000000',1);
      doc.strokeColor('#000000',1);      

      doc.moveDown(1);
      doc.fontSize(14).font('font/Calibri Bold.ttf');
      y_pos = doc.y;
      doc.moveDown(1);
      doc.text('Quotation:', x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.3);
      y_pos = doc.y;
      doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
      doc.text(headerData[0][0].QuoEstimateText, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(1);
    
    }



  } catch(e) {
    res.json({success: false});
  }

}

module.exports = { getBasicItinerary };


