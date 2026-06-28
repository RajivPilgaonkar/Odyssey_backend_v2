async function getExclusions (req, res, sequelize, doc, fs, pdfFile, isComposite) {

  const quotations_id = (req.body.data.quotations_id === undefined) ? 8125 : req.body.data.quotations_id;
  const subType = (req.body.data.reportSubType === undefined) ? 1 : req.body.data.reportSubType;

  /*=== get voucher info to print ===*/  
  var detailData = await sequelize.query(
    "SELECT QuoExcl_id, QuoExclusion " + 
      " FROM QuoExcl " +
      " WHERE Quotations_id = " + quotations_id.toString() + " " +
      " ORDER BY SrNo ",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get inclusion data details " });
    });

  /*=== get voucher info to print ===*/  
  var subDetailData = await sequelize.query(
    "SELECT qd.QuoExcl_id, qd.QuoExclusionDetail " + 
      " FROM QuoExcl q " + 
      " LEFT JOIN QuoExclDetails qd  ON q.QuoExcl_id = qd.QuoExcl_id " +
      " WHERE q.Quotations_id = " + quotations_id.toString() + " " +
      " AND qd.Display = 1 " +
      " ORDER BY qd.SrNo ",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get inclusion data details " });
    });

  const fontSize = 12;
  
  try {

    //if (!isComposite) {
    //  doc.pipe(fs.createWriteStream(pdfFile));
   // }

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

    detailData[0].forEach(function (record) {

      doc.fontSize(14).font('font/Calibri Bold.ttf');
      x_pos = x_pos_left;
      y_pos = doc.y;
      doc.text(record.QuoExclusion, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.2);

      // important to replace \r\n from lists otherwise it crashes
      const filteredData = subDetailData[0].filter(rec => rec.QuoExcl_id === record.QuoExcl_id);
      const list = filteredData.map(elem => elem.QuoExclusionDetail.replace(/\r\n?/g, ""));

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
      
    });
                          

  } catch(e) {
    res.json({success: false});
  }

}

module.exports = { getExclusions };


