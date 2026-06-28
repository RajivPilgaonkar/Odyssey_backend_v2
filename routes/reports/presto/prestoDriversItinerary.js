async function getDriversItinerary (req, res, sequelize, doc, fs, pdfFile, isComposite) {

  const quotations_id = (req.body.data.quotations_id === undefined) ? 8125 : req.body.data.quotations_id;

  /*=== get voucher info to print ===*/  
  var detailData = await sequelize.query(
    "EXEC [p_DriverItin] " + 
      quotations_id.toString(),{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get inclusion data details " });
    });


  const fontSize = 12;

  const unique = [...new Set(detailData[0].map(item => item.GroupNo))]; 

  try {

    //if (!isComposite) {
    //  doc.pipe(fs.createWriteStream(pdfFile));
    //}

    /*=== Header ===*/
    var x_pos_left = 36;
    var y_pos = doc.y;
    var x_pos = x_pos_left;

    unique.forEach(function (record, index) {

      // Each Group on a separate page
      if (index > 0) {
        doc.addPage();
      }

      const data = detailData[0].filter(rec => rec.GroupNo === record);

      doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
      y_pos = doc.y;
      doc.text(data[0].MainReportString, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.5);

      y_pos = doc.y;
      doc.text(data[0].MainReleaseString, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(1);

      y_pos = doc.y;
      doc.fontSize(fontSize).font('font/Calibri Bold.ttf');
      doc.text(data[0].VoucherString3, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(1);

      y_pos = doc.y;
      doc.fillColor('#000000',0.2);
      doc.strokeColor('#000000',0.2);
      doc.moveTo(x_pos_left, y_pos);  
      doc.lineTo(doc.page.width - doc.page.margins.right - doc.page.margins.left,y_pos);  
      doc.lineWidth(1);
      doc.stroke();  

      doc.fillColor('#000000',1);
      doc.strokeColor('#000000',1);
  
      doc.moveDown(1);

      data.forEach(function (rec) {
          
        y_pos = doc.y;
        doc.fontSize(fontSize).font('font/Calibri Bold.ttf');
        doc.text(rec.DateStr, x_pos, y_pos, {align: 'left'} );      
        doc.moveDown(0.1);

        y_pos = doc.y;
        doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
        doc.text(rec.Str1, x_pos, y_pos, {align: 'left'} );      
        doc.moveDown(1);        
        
      });

      doc.moveDown(1);        

      y_pos = doc.y;
      doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
      doc.text(data[0].ReleaseStr, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(1);        

      y_pos = doc.y;
      doc.fillColor('#000000',0.2);
      doc.strokeColor('#000000',0.2);
      doc.moveTo(x_pos_left, y_pos);  
      doc.lineTo(doc.page.width - doc.page.margins.right - doc.page.margins.left,y_pos);  
      doc.lineWidth(1);
      doc.stroke();  
    
      doc.fillColor('#000000',1);
      doc.strokeColor('#000000',1);
  
    });
  
  } catch(e) {
    res.json({success: false});
  }

}

module.exports = { getDriversItinerary };

