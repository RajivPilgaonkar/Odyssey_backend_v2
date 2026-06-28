async function getWelcomeLetter (req, res, sequelize, docObj) {

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

  const fontSize = 24;
  const font = 'Calibri';

  let textArr1 = [
    {text: "Dear " + headerData[0][0].PaxName, color: '000000', break: 12, font: font, size: fontSize},
    {text: "We welcome you to India and hope you had a pleasant flight.", color: '000000', break: 2, font: font, size: fontSize},
    {text: headerData[0][0].Organisation, color: '000000', break: 2, font: font, size: fontSize},
    {text: "Please find enclosed some important travel documents for your trip:", color: '000000', break: 2, font: font, size: fontSize},        
  ];

  let textArr2 = [{text: "Set of Vouchers", color: '000000', font: font, size: fontSize}];
  detailData[0].forEach(rec => {
    textArr2.push({text: rec.QuoString, font: font, size: fontSize});
  });

  let textArr3 = [
    {text: "There are also some information sheets which may further help you to prepare yourself for your trip:", color: '000000', break: 2, font: font, size: fontSize},
  ];

  let textArr4 = [
    {text: "Itinerary", color: '000000', font: font, size: fontSize, bullet: {level: 0}},
    {text: "Detailed Itinerary", color: '000000', font: font, size: fontSize, bullet: {level: 0}},
    {text: "List of Hotel & Agent Addresses", color: '000000', font: font, size: fontSize, bullet: {level: 0}},
    {text: "General Information", color: '000000', font: font, size: fontSize, bullet: {level: 0}},
  ];

  let textArr5 = [
    {text: headerData[0][0].ClosingRemark, color: '000000', break: 2, font: font, size: fontSize},
    {text: headerData[0][0].UserName, color: '000000', break: 2, font: font, size: fontSize, underline: {type:"single"} },
    {text: "Tour Executive", color: '000000', break: 1, font: font, size: fontSize},
  ];

  let docx = docObj.docx;

  const childTextArr1 = textArr1.map(rec => {return(new docx.TextRun(rec))});
  const childTextArr2 = textArr2.map(rec => {return(new docx.Paragraph({children: [new docx.TextRun(rec)], bullet: {level: 0}})         )});
  const childTextArr3 = textArr3.map(rec => {return(new docx.TextRun(rec))});
  const childTextArr4 = textArr4.map(rec => {return(new docx.Paragraph({children: [new docx.TextRun(rec)], bullet: {level: 0}})         )});
  const childTextArr5 = textArr5.map(rec => {return(new docx.TextRun(rec))});

  let childTextArray = [];
  childTextArray.push(new docx.Paragraph({children: childTextArr1}));
  childTextArray.push(...childTextArr2);
  childTextArray.push(new docx.Paragraph({children: childTextArr3}));
  childTextArray.push(...childTextArr4);
  childTextArray.push(new docx.Paragraph({children: childTextArr5}));

  try {

    docObj.doc = new docx.Document({
      sections: [
        {
          properties: {},
          children: childTextArray
        },
      ],
    });

  } catch(e) {
    res.json({success: false});
  }

}


module.exports = { getWelcomeLetter };


