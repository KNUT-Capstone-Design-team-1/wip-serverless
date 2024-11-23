require("dotenv").config();
const axios = require("axios");

async function requestToAPI(req) {
  try {
    const { ITEM_SEQ } = req.query;
    const { API_URL, ENC_SERVICE_KEY } = process.env;

    if (!ITEM_SEQ) {
      throw new Error(`Invalid query ${ITEM_SEQ}`);
    }

    const result = await axios.get(
      `${API_URL}&serviceKey=${ENC_SERVICE_KEY}&item_seq=${ITEM_SEQ}`
    );

    const drugDetail = result?.data?.body?.items?.[0];

    if (!drugDetail) {
      console.log("Invalid response %s", result?.data?.body);
      throw new Error(`Invalid response`);
    }

    return drugDetail;
  } catch (e) {
    console.log("Standard API Error", e.stack || e);
    throw e;
  }
}

async function name() {
  const result = await requestToAPI({ query: { ITEM_SEQ: "195500005" } });

  console.log(result);
}

name();
