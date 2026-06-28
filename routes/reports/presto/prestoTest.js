const imgHelper = require("../imgHelper");

async function getTest (req, res, sequelize, doc, fs, pdfFile, isComposite) {

  /*=== Header ===*/
  var x_pos_left = 36;
  var y_pos = doc.y;
  var x_pos = x_pos_left;

  try {

    y_pos = 5;

    var src = 'http://127.0.0.1/BackOffice_img/web_images/city/city_2_large_2.jpg';
    const img = await imgHelper.fetchImage(src);
    if (img !== null) {
      doc.image(img, x_pos, y_pos, {width: doc.page.width - doc.page.margins.right - doc.page.margins.left});    
    }
    y_pos = doc.y;
    doc.moveDown(12);  

  } catch(e) {
    res.json({success: false});
  }

}

module.exports = { getTest };


