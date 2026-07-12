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
      "SELECT qpd.SrNo, c.city, qpd.DaySummaryInfo " +
        "FROM QuoPrintDays qpd " +
        "LEFT JOIN QuoCities qc ON qpd.QuoCities_id = qc.QuoCities_id " +
        "LEFT JOIN Cities c ON qc.ToCities_id = c.cities_id " +
        "WHERE qpd.QuoPrint_id = " + Number(quoPrint_id),{});

    return rows;
  }

  /*=== gathers all the fields needed for a Vamoos itinerary from the various Presto tables ===*/
  async function getVamoosItineraryData(quoPrint_id) {
    const quoPrint = await getQuoPrintData(quoPrint_id);
    const quoPrintDays = await getQuoPrintDays(quoPrint_id);

    return {
      quoPrint,
      quoPrintDays
    };
  }

  return {
    getQuoPrintData,
    getQuoPrintDays,
    getVamoosItineraryData
  };

};
