async function getHotelsAgents (req, res, sequelize, doc, fs, pdfFile) {

  const columnsArr = 
    [
      {colName: 'City', fieldName: 'City', xPos: 36, colType: 0},
      {colName: 'Hotel/Agent', fieldName: 'Organisation', xPos: 120, colType: 1},
      {colName: 'Address', fieldName: 'Address', xPos: 300, colType: 0},
      {colName: 'Phone', fieldName: 'Phone', xPos: 450, colType: 0},
    ];

  for (var i=0; i<columnsArr.length; i++) {
    columnsArr[i].width = (i<columnsArr.length-1) ? columnsArr[i+1].xPos - columnsArr[i].xPos : doc.page.width - doc.page.margins.right - columnsArr[i].xPos;
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

  /*=== get voucher info to print ===*/  
  var detailData = await sequelize.query(
    "EXEC p_Rpt_QuoHotelAgentList " + quotations_id.toString() + ",3 ",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get inclusion data details " });
    });

  if (req.body.data.reportSubType === 2) {
    detailData[0] = detailData[0].filter(rec => rec.AgentType === 'Hotels');
  }
  if (req.body.data.reportSubType === 3) {
    detailData[0] = detailData[0].filter(rec => rec.AgentType === 'Agents');
  }

  const fontSize = 12;
  const detailFontSize = 10;
    
  try {

    //doc.pipe(fs.createWriteStream(pdfFile));

    /*=== Header ===*/
    var x_pos_left = 36;
    var y_pos = doc.y;
    var x_pos = x_pos_left;

    doc.fontSize(14).font('font/Calibri Bold.ttf');
    doc.text('Hotels & Agents:', x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.5);

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
    //y_pos = doc.y;
    //doc.moveTo(x_pos_left, y_pos);
    //doc.lineTo(doc.page.width - doc.page.margins.right,y_pos);  
    //doc.lineWidth(1);
    //doc.stroke();  

    doc.moveDown(1);

    const unique = [...new Set(detailData[0].map(item => item.AgentType))]; 

    unique.forEach(function (record) {

      doc.fontSize(fontSize).font('font/Calibri Bold.ttf');
      x_pos = x_pos_left;
      y_pos = doc.y;
      doc.text(record, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.2);
      
      // important to replace \r\n from lists otherwise it crashes
      const filteredData = detailData[0].filter(rec => rec.AgentType === record);

      if (filteredData.length > 0) {

        // Draw horizontal line
        y_pos = doc.y;
        doc.moveTo(x_pos_left, y_pos);
        doc.lineTo(doc.page.width - doc.page.margins.right,y_pos);  
        doc.lineWidth(1);
        doc.stroke();  

        doc.moveDown(0.2);
        y_pos = doc.y;

        columnsArr.forEach(function (filteredRec) {
          doc.fontSize(detailFontSize).font('font/Calibri Bold.ttf');
          x_pos = filteredRec.xPos;
          colName = (filteredRec.colType === 1) ? record.slice(0,-1) : filteredRec.colName;
          doc.text(colName, x_pos, y_pos, {align: 'left'});                
        })    

        // Draw horizontal line
        y_pos = doc.y;
        doc.moveTo(x_pos_left, y_pos);
        doc.lineTo(doc.page.width - doc.page.margins.right,y_pos);  
        doc.lineWidth(1);
        doc.stroke();  

        doc.moveDown(0.2);
        y_pos = doc.y;

        doc.fontSize(detailFontSize).font('font/Calibri Regular.ttf');
        filteredData.forEach(function (filteredRec) {

          var y_pos_max = y_pos; 

          columnsArr.forEach(function (cols) {
            x_pos = cols.xPos;
            var field = filteredRec[cols.fieldName];
            if (field !== null) {
              field = field.replace(/\r\n|\r/g, '\n');
            }        
            doc.text(field, x_pos, y_pos, {align: 'left', width: cols.width});                
            y_pos_max = (doc.y > y_pos_max) ? doc.y : y_pos_max;
          });

          // Reset y position to longest of city, org, address, tel
          doc.y = y_pos_max;
          doc.moveTo(x_pos_left, y_pos_max);
          doc.moveDown(0.5);
          y_pos = doc.y;
          
        });    

      }
                
      doc.moveDown(1);
      
    });
                          

  } catch(e) {
    res.json({success: false});
  }

}

module.exports = { getHotelsAgents };


