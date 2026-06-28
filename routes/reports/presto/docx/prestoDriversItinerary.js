async function getDriversItinerary (req, res, sequelize, docObj) {

  const quotations_id = (req.body.data.quotations_id === undefined) ? 8125 : req.body.data.quotations_id;

  /*=== General Introduction ===*/  
  var detailData = await sequelize.query(
    "EXEC [p_DriverItin] " + 
      quotations_id.toString(),{})
    .catch(function (err) {
      return res.status(400).json({ message: "error while trying to get inclusion data details " });
    });

  const fontSize = 24;
  const font = 'Calibri';

  let docx = docObj.docx;

  const unique = [...new Set(detailData[0].map(item => item.GroupNo))]; 

  let childTextArray = [];
  let sectionArr = [];

  unique.forEach(function (record, index) {

    const data = detailData[0].filter(rec => rec.GroupNo === record);

    let textArr1 = [
      {text: data[0].MainReportString, color: '000000', break: 1, font: font, size: fontSize},
      {text: data[0].MainReleaseString, color: '000000', break: 1, font: font, size: fontSize},
      {text: data[0].VoucherString3, color: '000000', break: 2, font: font, size: fontSize, bold: true,},
    ];

    let textArr2 = [];
    data.forEach(function (rec) {
      textArr2.push({text: rec.DateStr, color: '000000', break: 1, font: font, size: fontSize, bold: true});
      textArr2.push({text: rec.Str1, color: '000000', break: 1, font: font, size: fontSize});
      textArr2.push({text: '', color: '000000', break: 1, font: font, size: fontSize});
    })

    let textArr3 = [
      {text: data[0].ReleaseStr, color: '000000', break: 1, font: font, size: fontSize},
    ];

    const childTextArr1 = textArr1.map(rec => {return(new docx.TextRun(rec))});
    const childTextArr2 = textArr2.map(rec => {return(new docx.TextRun(rec))});
    const childTextArr3 = textArr3.map(rec => {return(new docx.TextRun(rec))});

    childTextArray.push([]);
    childTextArray[index].push(new docx.Paragraph({children: childTextArr1}));
    childTextArray[index].push(new docx.Paragraph({text: "", break: 3, border: {bottom: {space: 1, style: "single", size: 6}}}));
    childTextArray[index].push(new docx.Paragraph({children: childTextArr2}));
    childTextArray[index].push(new docx.Paragraph({children: childTextArr3}));
    childTextArray[index].push(new docx.Paragraph({text: "", break: 3, border: {bottom: {space: 1, style: "single", size: 6}}}));

    sectionArr.push({properties: {}, children: childTextArray[index]});
      
  });
 
  try {

    docObj.doc = new docx.Document({
      sections: sectionArr,
    });

  } catch(e) {
    res.json({success: false});
  }

}

module.exports = { getDriversItinerary };


