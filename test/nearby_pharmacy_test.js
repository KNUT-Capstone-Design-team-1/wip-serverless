require("dotenv").config();
const axios = require("axios");

async function requestToAPI(req) {
  try {
    const { NEAR_BY_PHARMACY_URL, SAFE_MAP_SERVICE_KEY } = process.env;

    const result = await axios.get(
      `${NEAR_BY_PHARMACY_URL}&serviceKey=${SAFE_MAP_SERVICE_KEY}`
    );

    console.log(`${NEAR_BY_PHARMACY_URL}&serviceKey=${SAFE_MAP_SERVICE_KEY}`)

    const pharmacies = result?.data?.response?.body?.items;

    if (!pharmacies) {
      console.log("Invalid response %s", result?.data?.response);
      throw new Error(`Invalid response`);
    }

    return pharmacies;
  } catch (e) {
    console.log("Standard API Error", e.stack || e);
    throw e;
  }
}

async function name() {
  const result = await requestToAPI();

  console.log(result);
}

name();
