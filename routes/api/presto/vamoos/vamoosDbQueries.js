module.exports = (sequelize) => {

  async function getQuoPrintData(quoPrint_id) {
    const [rows] = await sequelize.query(
      "SELECT qp.QuoPrint_id, qp.Quotations_id, qp.PaxInfo, c.city AS StartCity, " + 
        "q.StartDate, q.EndDate, c2.country, c.Latitude, c.Longitude, q.Reference " +
        "FROM QuoPrint qp " +
	      "LEFT JOIN QuoPrintDays qpd ON qp.QuoPrint_id = qpd.QuoPrint_id " +
	      "LEFT JOIN QuoCities qc ON qpd.QuoCities_id = qc.QuoCities_id " +
	      "LEFT JOIN Cities c ON qc.ToCities_id = c.cities_id " +
	      "LEFT JOIN Quotations q ON q.Quotations_id = qc.Quotations_id " +
	      "LEFT JOIN Countries c2 ON c2.countries_id = c.countries_id " +
        "WHERE qp.QuoPrint_id = " + Number(quoPrint_id) + " " +
        "AND qpd.SrNo = 1",{});

    return rows[0];
  }

  async function getQuoPrintDays(quoPrint_id) {
    const [rows] = await sequelize.query(
      "SELECT qpd.SrNo, c.city, qpd.DaySummaryInfo, c.cities_id " +
        "FROM QuoPrintDays qpd " +
        "LEFT JOIN QuoCities qc ON qpd.QuoCities_id = qc.QuoCities_id " +
        "LEFT JOIN Cities c ON qc.ToCities_id = c.cities_id " +
        "WHERE qpd.QuoPrint_id = " + Number(quoPrint_id),{});

    return rows;
  }

  async function getImageBaseUrl() {
    const [rows] = await sequelize.query(
      "SELECT text FROM defaults WHERE defaults_id = 51",{});

    return rows[0] && rows[0].text;
  }

  async function getHotelsByDay(quotations_id) {
    const [rows] = await sequelize.query(
      "SELECT DATEDIFF(day, (SELECT MIN(DateIn) FROM QuoCities WHERE Quotations_id = " + Number(quotations_id) + "), DateIn)+1 AS DayNo, " +
        "a.organisation AS Hotel, c.city, c.Latitude, c.Longitude, a.address, " +
        "(SELECT TOP 1 COALESCE(firstname,'') + ' ' + COALESCE(lastname,'') + ' (' + COALESCE(mobile,'')  + ')' " +
        "   FROM addressdetails ad " +
        " WHERE qa.HotelAddressbook_id = ad.addressbook_id " +
        " ORDER BY OrderNo) AS Contact " +
        "FROM QuoAccommodation qa " +
        "LEFT JOIN addressbook a ON qa.HotelAddressbook_id = a.addressbook_id " +
        "LEFT JOIN cities c ON a.cities_id = c.cities_id " +
        "WHERE Quotations_id = " + Number(quotations_id),{});

    return rows;
  }

  async function getServicesByDay(quotations_id) {
    const [rows] = await sequelize.query(
      "EXEC p_Rpt_QuoTourHotelAgentList " + Number(quotations_id) + ", 1",{});

    return rows;
  }

  /*=== gathers all the fields needed for a Vamoos itinerary from the various Presto tables ===*/
  async function getVamoosItineraryData(quoPrint_id) {
    const quoPrint = await getQuoPrintData(quoPrint_id);
    const quoPrintDays = await getQuoPrintDays(quoPrint_id);
    const imageBaseUrl = await getImageBaseUrl();
    const hotelsByDay = await getHotelsByDay(quoPrint.Quotations_id);
    const servicesByDay = await getServicesByDay(quoPrint.Quotations_id);

    return {
      quoPrint,
      quoPrintDays,
      imageBaseUrl,
      hotelsByDay,
      servicesByDay
    };
  }

  return {
    getQuoPrintData,
    getQuoPrintDays,
    getImageBaseUrl,
    getHotelsByDay,
    getServicesByDay,
    getVamoosItineraryData
  };

};
