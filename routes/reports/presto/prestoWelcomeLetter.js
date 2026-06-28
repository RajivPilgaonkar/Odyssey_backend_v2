async function getWelcomeLetter (req, res, sequelize, doc, fs, pdfFile, isComposite) {

  const quotations_id = (req.body.data.quotations_id === undefined) ? 8125 : req.body.data.quotations_id;

  /*=== General Introduction ===*/  
  var headerData = await sequelize.query(
    "EXEC [p_WelcomeLetter] " + 
      quotations_id.toString() + ", 1 ",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get inclusion data details " });
    });

  /*=== Ticket Details ===*/  
  var detailData = await sequelize.query(
    "EXEC [p_WelcomeLetter] " + 
      quotations_id.toString() + ", 2 ",{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get inclusion data details " });
    });

  const fontSize = 12;

  // move down 10 lines
  for (var i=0; i<12; i++) {
    doc.moveDown(1);
  }

  try {

    //if (!isComposite) {
    //  doc.pipe(fs.createWriteStream(pdfFile));
    //}

    /*=== Header ===*/
    var x_pos_left = 36;
    var y_pos = doc.y;
    var x_pos = x_pos_left;

    doc.fontSize(fontSize).font('font/Calibri Regular.ttf');

    y_pos = doc.y;
    doc.text(headerData[0][0].PaxName, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(1);

    y_pos = doc.y;
    doc.text("We welcome you to India and hope you had a pleasant flight.", x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(1);

    y_pos = doc.y;
    doc.text(headerData[0][0].Organisation, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(1);

    y_pos = doc.y;
    doc.text("Please find enclosed some important travel documents for your trip:", x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.2);

    let list = detailData[0].map(elem => elem.QuoString.replace(/\r\n?/g, ""));
    list.unshift('Set of Vouchers');

    y_pos = doc.y;
    // A list is used to obtain bulleted points
    doc.list(list, x_pos, y_pos, {
      width: doc.page.width - doc.page.margins.right - doc.page.margins.left,
      align: 'left',
      listType: 'bullet',
      bulletRadius: 1, // use this value to almost hide the dots/bullets    
    });

    doc.moveDown(1);

    y_pos = doc.y;
    doc.text("There are also some information sheets which may further help you to prepare yourself for your trip:", x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.2);
    
    list = ["Itinerary", "Detailed Itinerary", "List of Hotel & Agent Addresses", "General Information"];

    y_pos = doc.y;
    // A list is used to obtain bulleted points
    doc.list(list, x_pos, y_pos, {
      width: doc.page.width - doc.page.margins.right - doc.page.margins.left,
      align: 'left',
      listType: 'bullet',
      bulletRadius: 1, // use this value to almost hide the dots/bullets    
    });

    doc.moveDown(2);
    
    y_pos = doc.y;
    doc.text(headerData[0][0].ClosingRemark, x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(2);
    
    y_pos = doc.y;
    doc.text(headerData[0][0].UserName, x_pos, y_pos, {align: 'left'} );      
    const width = doc.widthOfString(headerData[0][0].UserName);
    const height = doc.currentLineHeight();
        // Add the underline and link annotations
    doc.underline(x_pos, y_pos, width, height);        
    doc.moveDown(0.1);
    
    y_pos = doc.y;
    doc.text("Tour Executive", x_pos, y_pos, {align: 'left'} );      
    doc.moveDown(0.1);
  
  } catch(e) {
    res.json({success: false});
  }

}

module.exports = { getWelcomeLetter };

