module.exports = (sequelize) => {

  // QuoPrintDays.SrNo doesn't reliably start at 1 for every QuoPrint (confirmed: QuoPrint_id 7982
  // starts at SrNo=2, with no row 1 at all) - hardcoding "AND qpd.SrNo = 1" against a LEFT JOIN
  // silently behaves like an INNER JOIN when nothing matches, so a QuoPrint whose days don't start
  // at 1 returned zero rows entirely (crashing the caller reading .Quotations_id off undefined)
  // rather than falling back to whatever the actual first day is. TOP 1 + ORDER BY picks the
  // lowest SrNo instead of assuming it's 1, and still returns a (mostly-null) row via the LEFT
  // JOIN even if a QuoPrint has no QuoPrintDays rows at all.
  async function getQuoPrintData(quoPrint_id) {
    const [rows] = await sequelize.query(
      "SELECT TOP 1 qp.QuoPrint_id, qp.Quotations_id, qp.PaxInfo, c.city AS StartCity, " +
        "q.StartDate, q.EndDate, c2.country, c.Latitude, c.Longitude, q.Reference " +
        "FROM QuoPrint qp " +
	      "LEFT JOIN QuoPrintDays qpd ON qp.QuoPrint_id = qpd.QuoPrint_id " +
	      "LEFT JOIN QuoCities qc ON qpd.QuoCities_id = qc.QuoCities_id " +
	      "LEFT JOIN Cities c ON qc.ToCities_id = c.cities_id " +
	      "LEFT JOIN Quotations q ON q.Quotations_id = qc.Quotations_id " +
	      "LEFT JOIN Countries c2 ON c2.countries_id = c.countries_id " +
        "WHERE qp.QuoPrint_id = " + Number(quoPrint_id) + " " +
        "ORDER BY qpd.SrNo",{});

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

  async function getTourCards(quotations_id) {
    const [rows] = await sequelize.query(
      "EXEC p_Rpt_QuoTourCardFormat " + Number(quotations_id) + ", 1",{});

    return rows;
  }

  async function getCardServiceDescRows(quoLines_id) {
    const [rows] = await sequelize.query(
      "SELECT * FROM dbo.[f_GetCardServiceDescRows](" + Number(quoLines_id) + ")",{});

    return rows;
  }

  async function getHotelDescription(hotelAddressbook_id) {
    const [rows] = await sequelize.query(
      "SELECT a.Organisation, h.[description] " +
        "FROM addressbook a " +
        "LEFT JOIN hotels h ON a.addressbook_id = h.addressbook_id " +
        "WHERE a.addressbook_id = " + Number(hotelAddressbook_id),{});

    return rows[0];
  }

  async function getCityDescription(cities_id) {
    const [rows] = await sequelize.query(
      "SELECT c.City, c.writeup " +
        "FROM cities c " +
        "WHERE cities_id = " + Number(cities_id),{});

    return rows[0];
  }

  async function getServiceDescription(services_id) {
    const [rows] = await sequelize.query(
      "SELECT s.service, s.description, s.writeup " +
        "FROM services s " +
        "WHERE s.services_id = " + Number(services_id),{});

    return rows[0];
  }

  /*=== gathers all the fields needed for a Vamoos itinerary from the various Presto tables ===*/
  async function getVamoosItineraryData(quoPrint_id) {
    const quoPrint = await getQuoPrintData(quoPrint_id);
    const quoPrintDays = await getQuoPrintDays(quoPrint_id);
    const imageBaseUrl = await getImageBaseUrl();
    const hotelsByDay = await getHotelsByDay(quoPrint.Quotations_id);
    const servicesByDay = await getServicesByDay(quoPrint.Quotations_id);
    const tourCards = await getTourCards(quoPrint.Quotations_id);

    return {
      quoPrint,
      quoPrintDays,
      imageBaseUrl,
      hotelsByDay,
      servicesByDay,
      tourCards
    };
  }

  return {
    getQuoPrintData,
    getQuoPrintDays,
    getImageBaseUrl,
    getHotelsByDay,
    getServicesByDay,
    getTourCards,
    getCardServiceDescRows,
    getHotelDescription,
    getCityDescription,
    getServiceDescription,
    getVamoosItineraryData
  };

};
