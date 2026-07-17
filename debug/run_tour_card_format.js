require('dotenv').config({ path: './config/.env' });
const Sequelize = require('sequelize');
const db = require('../models');

const sequelize = new Sequelize(
  db.dbConfig.database, db.dbConfig.user, db.dbConfig.password,
  {
    host: db.dbConfig.server,
    port: db.dbConfig.port,
    dialect: 'mssql',
    dialectOptions: { options: { encrypt: true } },
    logging: false
  }
);

const quotations_id = process.argv[2] || 9312;

(async () => {
  const [rows] = await sequelize.query(`EXEC p_Rpt_QuoTourCardFormat ${Number(quotations_id)}, 1`, {});
  console.table(rows.map(r => ({
    CardNo: r.CardNo, SubCardNo: r.SubCardNo, ServiceDate: r.ServiceDate, AtTime: r.AtTime,
    Title: r.Title, ImageHint: r.ImageHint
  })));
  console.log(`\n${rows.length} total rows`);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
