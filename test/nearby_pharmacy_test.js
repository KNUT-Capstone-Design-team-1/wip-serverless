require("dotenv").config();
const axios = require("axios");

async function requestToAPI(req) {
  try {
    const { pageNo, numOfRows, Q0, Q1, QT, QN } = req.query;
    const { NEAR_BY_PHARMACY_URL, ENC_SERVICE_KEY } = process.env;

    const result = await axios.get(`${NEAR_BY_PHARMACY_URL}?serviceKey=${ENC_SERVICE_KEY}`, {
      params: {
        serviceKey: ENC_SERVICE_KEY,
        pageNo,
        numOfRows,
        Q0,
        Q1,
        QT,
        QN,
      },
    });

    const response = result?.data?.response;

    if (!response) {
      console.log("Invalid response %s", result?.data);
      throw new Error(`Invalid response`);
    }

    return response;
  } catch (e) {
    console.log("Standard API Error", e.stack || e);
    throw e;
  }
}

async function name() {
  const result = await requestToAPI({ query: { pageNo: "1", numOfRows: "10", Q0: "경기도", Q1: "성남시", QN: "삼성약국" } });

  console.log(result);
}

name();
