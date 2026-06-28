async function getInclusions (req, res, sequelize, doc, fs, pdfFile, isComposite) {

  const quoPrint_id = (req.body.data.quoPrint_id === undefined) ? 6163 : req.body.data.quoPrint_id;
  const subType = (req.body.data.reportSubType === undefined) ? 1 : req.body.data.reportSubType;

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
    "SELECT d.OrderNo, d.SrNo, d.ServiceType, d.Remarks " + 
      " FROM QuoPrintInclusions d " +
      " WHERE d.QuoPrint_id = " + quoPrint_id.toString() + " " +
      " ORDER BY d.OrderNo, d.SrNo ",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get inclusion data details " });
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

    if (isComposite && subType === 1) {
      // Draw horizontal line
      y_pos = doc.y;
      doc.fillColor('#000000',0.2);
      doc.strokeColor('#000000',0.2);
      doc.moveTo(x_pos_left, y_pos);
      doc.lineTo(doc.page.width - doc.page.margins.right,y_pos);  
      doc.lineWidth(1);
      doc.stroke();  
      doc.moveDown(1);
      y_pos = doc.y;
    }

    doc.fillColor('#000000',1);
    doc.strokeColor('#000000',1);
    doc.fontSize(14).font('font/Calibri Bold.ttf');
    doc.text('Inclusions:', x_pos, y_pos, {align: 'left'} );      
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

    const unique = [...new Set(detailData[0].map(item => item.OrderNo))]; 

    unique.forEach(function (record) {
    
      const index = detailData[0].findIndex(rec => rec.OrderNo === record);

      if (index > -1) {
        doc.fontSize(fontSize).font('font/Calibri Bold.ttf');
        x_pos = x_pos_left;
        y_pos = doc.y;
        doc.text(detailData[0][index].ServiceType, x_pos, y_pos, {align: 'left'} );      
        doc.moveDown(0.2);        
        
        // important to replace \r\n from lists otherwise it crashes
        const filteredData = detailData[0].filter(rec => rec.OrderNo === record);
        //const list = filteredData.map(elem => elem.Remarks.replace(/\r\n?/g, ""));
        const list = filteredData.map(elem => elem.Remarks.replace(/\r?\n|\r/g, ""));
  
        y_pos = doc.y;
        doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
        // A list is used to obtain bulleted points
        doc.list(list, x_pos, y_pos, {
          width: doc.page.width - doc.page.margins.right - doc.page.margins.left,
          align: 'left',
          listType: (subType === 1) ? 'bullet' : 'unordered',
          bulletRadius: (subType === 1) ? 1 : null, // use this value to almost hide the dots/bullets    
        });
                
        doc.moveDown(1);
        
      }

    });

  } catch(e) {
    return res.json({success: false});
  }

}

module.exports = { getInclusions };


