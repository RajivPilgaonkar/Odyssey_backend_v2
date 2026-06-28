var fs = require('fs');

async function getPagingBoard (req, res, sequelize, doc, fs, pdfFile, isComposite) {

  const quotations_id = (req.body.data.quotations_id === undefined) ? 8125 : req.body.data.quotations_id;

  /*=== get voucher info to print ===*/  
  var detailData = await sequelize.query(
    "EXEC [p_QuoPagingBoard] " + 
      quotations_id.toString(),{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get inclusion data details " });
    });


  const fontSize = 24;

  try {

    /*=== Header ===*/
    var x_pos_left = 36;
    var y_pos = doc.y;
    var x_pos = x_pos_left;    

    // logo
    const fileName = (detailData[0][0].PrincipalAgents_id !== null) ? detailData[0][0].PrincipalAgents_id.toString() + '.jpg' : 'x@#.jpg';
    let imgName = 'img/pagingboard/' + fileName;

    x_pos = x_pos_left;
    y_pos = doc.y;
    if (fs.existsSync(imgName)){
      const width = doc.page.width - doc.page.margins.right - doc.page.margins.left;
      doc.image(imgName, x_pos, y_pos, {fit: [width, 100], /*height: 100,*/ align: 'center', valign: 'center'} );
    }

    var x_pos = 36;
    doc.moveDown(2);

    //return;

    detailData[0].forEach(function (record) {

      doc.fontSize(72).font('font/Calibri Bold.ttf');
      y_pos = doc.y;
      doc.text(record.PaxNames, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.1);

      y_pos = doc.y;
      doc.fillColor('#000000',0.2);
      doc.strokeColor('#000000',0.2);
      doc.moveTo(x_pos_left, y_pos);  
      doc.lineTo(doc.page.width - doc.page.margins.right - doc.page.margins.left,y_pos);  
      doc.lineWidth(1);
      doc.stroke();  

      doc.fillColor('#000000',1);
      doc.strokeColor('#000000',1);

      doc.moveDown(0.3);

      doc.fontSize(24).font('font/Calibri Regular.ttf');
      y_pos = doc.y;
      doc.text(record.PrincipalAgent, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.6);

      y_pos = doc.y;
      doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
      doc.text(record.ArrivalDetails, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.6);

      y_pos = doc.y;
      doc.fontSize(fontSize).font('font/Calibri Regular.ttf');
      doc.text(record.HotelBooked, x_pos, y_pos, {align: 'left'} );      
      doc.moveDown(0.6);
      
    });
  
  } catch(e) {
    res.json({success: false});
  }

}

module.exports = { getPagingBoard };

