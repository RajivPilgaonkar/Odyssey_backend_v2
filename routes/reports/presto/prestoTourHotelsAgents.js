async function getTourHotelsAgents (req, res, sequelize, doc, fs, pdfFile) {

  const columnsArr = 
    [
      {colName: 'Day', fieldName: 'DayNo', xPos: 36, colType: 0},
      {colName: 'From', fieldName: 'FromCity', xPos: 67, colType: 0},
      {colName: 'To', fieldName: 'ToCity', xPos: 116, colType: 0},
      {colName: 'Date', fieldName: 'ServiceDate', xPos: 165, colType: 0},
      {colName: 'Time', fieldName: 'AtTime', xPos: 218, colType: 0},
      {colName: 'Hotel/Agent', fieldName: 'Organisation', xPos: 261, colType: 1, hasNewLine: true},
      {colName: 'Services Requested from Hotel/Agent', fieldName: 'ServiceDesc', xPos: 372, colType: 0, hasNewLine: true},
      {colName: 'Telephone No.', fieldName: 'Contact', xPos: 642, colType: 0, hasNewLine: true},
    ];

  for (var i=0; i<columnsArr.length; i++) {
    columnsArr[i].width = (i<columnsArr.length-1) ? columnsArr[i+1].xPos - columnsArr[i].xPos -3 : doc.page.width - doc.page.margins.right - columnsArr[i].xPos - 3;
  }

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
    "EXEC p_Rpt_QuoTourHotelAgentList " + quotations_id.toString() + ",1 ",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get inclusion data details " });
    });

  /*=== get voucher info to print ===*/  
  var phoneData = await sequelize.query(
    "SELECT text AS EmergencyPhone " + 
      " FROM Defaults " +
      " WHERE Defaults_id = 52",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get composite report data " });
    });

  //if (req.body.data.reportSubType === 2) {
  //  detailData[0] = detailData[0].filter(rec => rec.AgentType === 'Hotels');
  //}
  //if (req.body.data.reportSubType === 3) {
  //  detailData[0] = detailData[0].filter(rec => rec.AgentType === 'Agents');
  //}

  const fontSize = 12;
  const detailFontSize = 10;
    
  try {

    //doc.pipe(fs.createWriteStream(pdfFile));

    /*=== Header ===*/
    var x_pos_left = 36;
    var y_pos = doc.y;
    var x_pos = x_pos_left;

    doc.fontSize(fontSize).font('font/Calibri Bold.ttf');
    let title = 'List of services for : ' + headerData[0][0].PaxInfo + ' (' + quoData[0][0].TourCode + ')';
    doc.text(title, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.5);

    doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
    y_pos = doc.y;
    title = 'No. of Travellers :' + quoData[0][0].NumPax.toString();
    doc.text(title, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.3);
    y_pos = doc.y;
    doc.text(headerData[0][0].StartingInfo, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.3);
    y_pos = doc.y;
    doc.text(headerData[0][0].EndingInfo, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.5);
    y_pos = doc.y;

    doc.fontSize(fontSize).font('font/Calibri Bold.ttf');
    title = 'Emergency Contact No: ' + phoneData[0][0].EmergencyPhone;
    doc.text(title, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.3);
    y_pos = doc.y;
    title = 'You can also use our emergency number for any assistance you need with domestic flights and trains (if they are part of the services mentioned below)';
    doc.text(title, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.3);

    // Draw horizontal line
    y_pos = doc.y;
    doc.moveTo(x_pos_left, y_pos);
    doc.lineTo(doc.page.width - doc.page.margins.right,y_pos);  
    doc.lineWidth(1);
    doc.stroke();  

    doc.y = y_pos + 0.5;
    doc.moveDown(0.5);

    y_pos = doc.y;
    doc.fontSize(fontSize).font('font/Calibri Bold.ttf');
    columnsArr.forEach(function (filteredRec) {
      x_pos = filteredRec.xPos;
      doc.text(filteredRec.colName, x_pos, y_pos, {align: 'left'});                
    })    

    y_pos = doc.y;
    doc.moveDown(0.5);

    // Draw horizontal line
    y_pos = doc.y;
    doc.moveTo(x_pos_left, y_pos);
    doc.lineTo(doc.page.width - doc.page.margins.right,y_pos);  
    doc.lineWidth(1);
    doc.stroke();  

    doc.y = y_pos + 0.5;
    doc.moveDown(0.5);

    doc.fontSize(detailFontSize).font('font/Calibri Regular.ttf');

    doc.moveDown(1);

    detailData[0].forEach(function (record, index) {

      doc.moveDown(0.2);
      y_pos = doc.y;

      var y_pos_max = y_pos; 
      columnsArr.forEach(function (filteredRec) {
        x_pos = filteredRec.xPos;
        var field = record[filteredRec.fieldName];
        if (filteredRec.hasNewLine !== undefined && filteredRec.hasNewLine && field !== null) {
          field = field.replace(/\r\n|\r/g, '\n');
        }
        doc.text(field, x_pos, y_pos, {align: 'left', width: filteredRec.width});                
        y_pos_max = (doc.y > y_pos_max) ? doc.y : y_pos_max;
      })    

/*
      var y_pos_max = y_pos; 
      for (var i=0; i<columnsArr.length; i++) {
        x_pos = columnsArr[i].xPos;
        var field = record[columnsArr[i].fieldName];
        if (columnsArr[i].hasNewLine !== undefined && columnsArr[i].hasNewLine && field !== null) {
          field = field.replace(/\r\n|\r/g, '\n');
        }
        doc.text(field, x_pos, y_pos, {align: 'left', width: columnsArr[i].width});                
        y_pos_max = (doc.y > y_pos_max) ? doc.y : y_pos_max;
      }
*/
      doc.y = y_pos_max + 1;
      doc.moveDown(0.3);
      x_pos = columnsArr[1].xPos;
      y_pos = doc.y;
  
      // Draw horizontal line
      doc.moveDown(1);
      y_pos = doc.y;

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

module.exports = { getTourHotelsAgents };


