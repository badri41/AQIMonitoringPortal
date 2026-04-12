const express = require("express");

const {
  getDailyAqi,
  getOverviewAqi,
  getHistoricalAqi,
  getQueryResult,
} = require("../controllers/aqiController");

const router = express.Router();

router.get("/daily", getDailyAqi);
router.get("/overview", getOverviewAqi);
router.get("/historical", getHistoricalAqi);
router.get("/query/:id", getQueryResult);

module.exports = router;

