async function getComposite (req, res, sequelize, doc, fs, pdfFile, isComposite) {

  const quotations_id = (req.body.data.quotations_id === undefined) ? 8125 : req.body.data.quotations_id;
  const subType = (req.body.data.reportSubType === undefined) ? 1 : req.body.data.reportSubType;

  /*=== get voucher info to print ===*/  
  var detailData = await sequelize.query(
    "SELECT QuoRequest, QuoRequestDetails, QuoFor, QuoForDetails " + 
      " FROM dbo.[fn_QuoRequestDetails] (" +
      quotations_id.toString() + ") ",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get inclusion data details " });
    });

  const fontSize = 12;
  
  try {

    //doc.pipe(fs.createWriteStream(pdfFile));

    /*=== Header ===*/
    var x_pos_left = 36;
    var y_pos = doc.y;
    var x_pos = x_pos_left;

    if (subType === 1) {
      doc.image('img/presto/PrestoTop.jpg', x_pos, y_pos, {width: doc.page.width - doc.page.margins.right - doc.page.margins.left});    
      var y_pos = doc.y;

      // Move cursor below image (image height ≈ 144 points)
      // Adjust this number if PrestoTop.jpg changes size
      doc.moveDown(12);  
    }

    doc.fontSize(12).font('font/Calibri Bold.ttf');
    x_pos = x_pos_left;
    y_pos = doc.y;
    var title = detailData[0][0].QuoRequest;
    if (title !== null) {
      title = title.replace(/\r\n|\r/g, '\n');
    }
    doc.text(title, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.2);

    doc.fontSize(12).font('font/Calibri Regular.ttf');
    x_pos = x_pos_left;
    y_pos = doc.y;
    title = detailData[0][0].QuoRequestDetails;
    if (title !== null) {
      title = title.replace(/\r\n|\r/g, '\n');
    }
    doc.text(title, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(1);

    doc.fontSize(12).font('font/Calibri Bold.ttf');
    x_pos = x_pos_left;
    y_pos = doc.y;
    title = detailData[0][0].QuoFor;
    if (title !== null) {
      title = title.replace(/\r\n|\r/g, '\n');
    }
    doc.text(title, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.2);

    doc.fontSize(12).font('font/Calibri Regular.ttf');
    x_pos = x_pos_left;
    y_pos = doc.y;
    title = detailData[0][0].QuoForDetails;
    if (title !== null) {
      title = title.replace(/\r\n|\r/g, '\n');
    }
    doc.text(title, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(1);

    y_pos = doc.y;

    if (subType === 1) {
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

  } catch(e) {
    res.json({success: false});
  }

}

async function getCompositeFooter (req, res, sequelize, doc, fs, pdfFile, isComposite) {

  const quotations_id = (req.body.data.quotations_id === undefined) ? 8125 : req.body.data.quotations_id;
  const subType = (req.body.data.reportSubType === undefined) ? 1 : req.body.data.reportSubType;

  /*=== get option info of Principal Agent ===*/  
  var principalAgent = await sequelize.query(
    "SELECT CAST(COALESCE(a.PrintCo,1) AS BIT) AS PrintCo " +
    "FROM Quotations q " +
    "LEFT JOIN Addressbook a ON q.PrincipalAgents_id = a.Addressbook_id " +
    "WHERE q.Quotations_id = " + quotations_id.toString() + " ", {})
      .catch(function (err) {
        return res.status(400).json({ message: "error while trying to get company data " });
    });
  
  /*=== get company info for Odyssey Tours & Travels ===*/  
  var companies = await sequelize.query(
    "SELECT organisation, address, city, postalcode, phone, fax, email FROM addressbook " + 
    " WHERE addressbook_id = 68", {})
      .catch(function (err) {
        return res.status(400).json({ message: "error while trying to get company data " });
    });

  try {

    //doc.pipe(fs.createWriteStream(pdfFile));    

    /*=== Header ===*/
    var x_pos_left = 36;
    var y_pos = doc.y;
    var x_pos = x_pos_left;

    y_pos = doc.y;

    if (subType === 1) {
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

    const width = doc.page.width - doc.page.margins.right - doc.page.margins.left;

    if (companies.length > 0 && companies[0].length > 0 && principalAgent[0][0].PrintCo) {
      const company = companies[0][0];
      doc.fontSize(14).font('font/Calibri Bold.ttf');
      x_pos = x_pos_left + 10;
      doc.text(company.organisation, x_pos, y_pos, {width: width, align: 'center'} );

      doc.fontSize(12).font('font/Calibri Regular.ttf');
      doc.text(company.address.replace(/\r\n|\r/g, '\n') + ', ' + company.city + ', ' + company.postalcode, {width: width, align: 'center'} );
      doc.text('Tel: ' + company.phone, {width: width, align: 'center'} );
      doc.text('Fax: ' + company.fax, {width: width, align: 'center'} );
      doc.text('Email: ' + company.email, {width: width, align: 'center'} );  
    }

    doc.moveDown(2);

    if (doc.y > 0.77*(doc.page.height - doc.page.margins.bottom)) {
      doc.addPage();
    }

    var y_pos = doc.y;

    if (subType === 1) {
      doc.image('img/presto/PrestoBottom.jpg', x_pos, y_pos, {width: doc.page.width - doc.page.margins.right - doc.page.margins.left});    
      var y_pos = doc.y;
      doc.moveDown(1);
    }

  } catch(e) {
    res.json({success: false});
  }

}


module.exports = { getComposite, getCompositeFooter };


