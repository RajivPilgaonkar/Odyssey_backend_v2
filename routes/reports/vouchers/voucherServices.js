async function getVoucherServices (req, res, sequelize, doc, fs) {
  
  const labelPosX = [350,440];
    
  const fromVoucher = (req.body.data.voucherRange === null) ? 'null' : req.body.data.voucherRange[0].toString();
  const toVoucher = (req.body.data.voucherRange === null) ? 'null' : req.body.data.voucherRange[1].toString();
  const yearRef= (req.body.data.yearRef === null) ? 'null' : req.body.data.yearRef.toString();

  /*=== get voucher info to print ===*/  
  var vouchers = await sequelize.query(
    "EXEC p_Rpt_PrintVouchers '" + req.body.data.tourCode + "', '" + 
      req.body.data.tourDate + "'," +
      fromVoucher + "," + toVoucher + "," + yearRef + ",1 ", {})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get vouchers " });
  });

  /*=== filter on vouchers requested ===*/  
  if (req.body.data.vouchers !== null) {
    vouchers[0] = vouchers[0].filter(rec => req.body.data.vouchers.includes(rec.VoucherNo));      
  }

  /*=== only accommodation ===*/  
  if (req.body.data.onlyAccommodation !== undefined && req.body.data.onlyAccommodation === true) {
    vouchers[0] = vouchers[0].filter(rec => rec.VoucherTypes_id === 3);      
  }

  //vouchers[0] = vouchers[0].slice(0,1);      

  /*=== get id info for Odyssey Tours & Travels (Solita LLP) companies_id = 4 ===*/  
  var ids = await sequelize.query(
    "SELECT c.name AS TradingName, c.DivName, c.Pan, c.Gstin, c.Llpin, " + 
    "a.address, a.city, a.postalcode, a.phone, a.fax, a.email " +
    "FROM companies c " +
    "LEFT JOIN Addressbook a ON c.companyAddressbook_id = a.addressbook_id " + 
    " WHERE c.companies_id = 4", {})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get company id info " });
  });  

  const fontSize = 12;

    
  try {

      /*=== in the node backend, ensure that there is a directory 'vouchers' ===*/    
      var dir = './vouchers';

      /*=== create directory if it does not exist ===*/    
      if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, function(err) {
          return res.status(400).json({ message: "could not create vouchers directory" });
        });
      }

      /*=== loop through all vouchers for the tour ===*/    
      let count = 0;
      vouchers[0].forEach(function (record) {

        x_pos_left = 36;
        y_pos = doc.y;
        y_pos_top = y_pos;

        doc.moveDown(2);

        // logo
        x_pos = x_pos_left + 350;
        y_pos = doc.y;
        doc.image('img/OdyToursLogo.png', x_pos, y_pos, {width: 160, height: 115});

        // *** Organisation
        doc.fontSize(fontSize).font('font/georgia bold.ttf');
        x_pos = x_pos_left;
        doc.text(record.Organisation, x_pos, y_pos, {align: 'left'} );      

        // *** Address
        if (record.Address !== null) {
          doc.moveDown(0.3);
          doc.fontSize(fontSize).font('font/Georgia.ttf');
          let address = record.Address.replace(/\r\n|\r/g, '\n');
          address = address.replace(/\n\n/g, '\n');
          address = address.replace(/\n\n/g, '\n');
          doc.text(address, {align: 'left'} );
        }

        // *** Phone
        doc.moveDown(0.3);
        x_pos = x_pos_left;
        y_pos = doc.y;
        doc.text(record.Phone, x_pos, y_pos, {align: 'left'} );      

        doc.moveDown(1.0);
        y_pos = doc.y;

        // *** Voucher No
        doc.fontSize(fontSize).font('font/georgia bold.ttf');
        x_pos = x_pos_left;
        doc.text('Voucher No: ' + record.VoucherNo, x_pos, y_pos);

        /*=== horizontal line ===*/        
        doc.moveDown(1.0);
        y_pos = doc.y;

        addHorizontalLine (doc, x_pos_left, y_pos);

        // *** Through Agent        
        if (record.BookNotes !== null && record.BookNotes.trim().length > 0) {
          doc.moveDown(1.0);
          y_pos = doc.y;

          doc.fontSize(fontSize).font('font/Georgia.ttf');
          x_pos = x_pos_left;
          y_pos = doc.y;
          doc.text(record.BookNotes, x_pos, y_pos, {align: 'left'} );  

          /*=== horizontal line ===*/        
          doc.moveDown(1.0);
          y_pos = doc.y;          
          addHorizontalLine (doc, x_pos_left, y_pos);

        }

        if (record.vouchertypes_id && record.VoucherServiceCity.trim() !== '') {

          doc.moveDown(1.0);
          y_pos = doc.y;

          doc.fontSize(fontSize).font('font/Georgia.ttf');
          x_pos = x_pos_left;
          y_pos = doc.y;
          doc.text(record.VoucherServiceCity, x_pos, y_pos, {align: 'left'} );  

          /*=== horizontal line ===*/        
          doc.moveDown(1.0);
          y_pos = doc.y;
          addHorizontalLine (doc, x_pos_left, y_pos);
          
        }

        // *** Clients
        doc.moveDown(1.0);
        doc.fontSize(fontSize).font('font/georgia bold.ttf');
        x_pos = doc.x;
        y_pos = doc.y;
        doc.text('Clients', {align: 'left', width: 300} );

        doc.moveDown(0.3);
        y_pos = doc.y;
        
        doc.fontSize(fontSize).font('font/Georgia.ttf');
        x_pos = x_pos_left+10;
        y_pos = doc.y;
        doc.text(record.Client, x_pos, y_pos, {} );

        // *** Services
        if (record.ServicesDesc !== null) {
          doc.moveDown(1.0);
          doc.fontSize(fontSize).font('font/georgia bold.ttf');
          x_pos = x_pos_left;
          y_pos = doc.y;
          doc.text('Services :', x_pos, y_pos, {align: 'left', width: 300} );
        
          doc.moveDown(0.3);
          doc.fontSize(fontSize).font('font/Georgia.ttf');
          x_pos = doc.x+10;
          y_pos = doc.y;

          const listString = record.ServicesDesc.split('#');

          doc.fontSize(fontSize).font('font/Georgia.ttf');
          x_pos = x_pos_left+10;
          y_pos = doc.y;
          doc.list(listString, x_pos, y_pos, {
            width: doc.page.width - doc.page.margins.right - doc.page.margins.left,
            align: 'left',
            listType: 'bullet',
            bulletRadius: 1, // use this value to almost hide the dots/bullets    
            lineGap: 3
          });

        }

        /*=== horizontal line ===*/        
        doc.moveDown(1.0);
        y_pos = doc.y;
        addHorizontalLine (doc, x_pos_left, y_pos);

        // *** Notes        
        if (record.Notes !== null && record.Notes.trim().length > 0) {
          doc.moveDown(1);
          doc.fontSize(fontSize).font('font/georgia bold.ttf');
          x_pos = x_pos_left;
          y_pos = doc.y;
          doc.text('Notes :', x_pos, y_pos, {align: 'left', width: 300} );
            
          const listString = record.Notes.split('#');

          doc.fontSize(fontSize).font('font/Georgia.ttf');
          x_pos = x_pos_left+10;
          y_pos = doc.y;
          doc.list(listString, x_pos, y_pos, {
            width: doc.page.width - doc.page.margins.right - doc.page.margins.left,
            align: 'left',
            listType: 'bullet',
            bulletRadius: 1, // use this value to almost hide the dots/bullets    
            lineGap: 3
          });
    
        }

        doc.moveDown(2);

        // *** Hotel / Agent Remarks
        if (record.HotelAgentRemarks !== null) {
          doc.fontSize(fontSize).font('font/georgia bold.ttf');
          x_pos = x_pos_left;
          y_pos = doc.y;
          doc.text(record.HotelAgentRemarks.replace(/\r\n|\r/g, '\n'), x_pos, y_pos, {} );  
          doc.moveDown(0.5);
        }

        // *** Bill us for the above services
        doc.moveDown(2);
        doc.fontSize(fontSize).font('font/georgia italic.ttf');
        x_pos = x_pos_left;
        y_pos = doc.y;
        const text = 'Bill us for the above services and collect all extras directly';
        const width = doc.widthOfString(text);
        const height = doc.currentLineHeight();    
        doc.underline(x_pos, y_pos, width, height);        
        doc.text(text, x_pos, y_pos, {} );

        // *** Issued By
        doc.moveDown(2);
        doc.fontSize(fontSize).font('font/Georgia.ttf');
        x_pos = x_pos_left + labelPosX[0];
        y_pos = doc.y;
        doc.text(record.IssuedBy, x_pos, y_pos, {});

        // *** Issued On
        doc.moveDown(0.4);
        doc.fontSize(fontSize).font('font/Georgia.ttf');
        x_pos = x_pos_left + labelPosX[0];
        y_pos = doc.y;
        doc.text(record.IssuedOn, x_pos, y_pos, {});

        // *** Footer with company info
        let bottom = doc.page.margins.bottom;        
        doc.page.margins.bottom = 0;
        x_pos = x_pos_left + 10;
        y_pos = 0;

        /*=== horizontal line ===*/        
        doc.moveDown(1.0);
        y_pos = doc.page.height - 120;
        addHorizontalLine (doc, x_pos_left, y_pos);

        doc.moveDown(0.5);
        y_pos += 10;

        const pageWidth = doc.page.width - doc.page.margins.right;

        if (ids.length > 0 && ids[0].length > 0) {
          const company = ids[0][0];
          doc.fontSize(fontSize-2).font('font/georgia bold italic.ttf');
          doc.text(company.TradingName, 20, y_pos, {
            width: pageWidth, 
            align: 'center',
            lineBreak: false
          });        
          doc.moveDown(0.5);
          y_pos = doc.y;
          doc.fontSize(fontSize-2).font('font/georgia italic.ttf');
          const id = ids[0][0];
          const companyDetails = 
            '(' + company.DivName + ')' + '\n' +
            company.address.replace(/\r\n|\r/g, '\n') + ', ' + company.city + ', ' + company.postalcode + '\n' + 
            'Tel: ' + company.phone + ',   ' + 'Email: ' + company.email + '\n' +
            'LLPIN: ' + company.Llpin + '    PAN: ' + company.Pan + '    GSTIN: ' + company.Gstin;
          doc.text(companyDetails, 20, y_pos, {
            width: pageWidth, 
            align: 'center',
            lineBreak: false
          });        
        }

        doc.page.margins.bottom = bottom;

        count++;

        /*=== label printing for client (each label is half a page) ===*/    
        if (count < vouchers[0].length) {
          doc.addPage();
        } 

      });
                          
  } catch(e) {
    res.json({success: false});
  }

}

function addHorizontalLine (doc, x_pos, y_pos) {
  doc.fillColor('#000000',0.2);
  doc.strokeColor('#000000',0.2);    
  doc.lineWidth(1);
  doc.moveTo(x_pos, y_pos);
  doc.lineTo(doc.page.width - doc.page.margins.right - doc.page.margins.left, y_pos);
  doc.stroke();  
  doc.fillColor('#000000',1);
  doc.strokeColor('#000000',1);    
}

module.exports = { getVoucherServices };


