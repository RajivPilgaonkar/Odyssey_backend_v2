module.exports = (sequelize) => {

  async function getQuoPrintData(quoPrint_id) {
    const [rows] = await sequelize.query(
      "SELECT * FROM QuoPrint WHERE QuoPrint_id = " + Number(quoPrint_id),{});

    return rows[0];
  }

  /*=== gathers all the fields needed for a Vamoos itinerary from the various Presto tables ===*/
  async function getVamoosItineraryData(quoPrint_id) {
    const quoPrint = await getQuoPrintData(quoPrint_id);

    return {
      quoPrint
    };
  }

  return {
    getQuoPrintData,
    getVamoosItineraryData
  };

};
