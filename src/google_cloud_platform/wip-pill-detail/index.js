require("dotenv").config();
const functions = require("@google-cloud/functions-framework");
const compression = require("compression");
const express = require("express");
const axios = require("axios");
const http = require("node:http");
const https = require("node:https");
const { authenticate } = require("./authentication");
const { CACHE_SECONDS, createResponseCache } = require("./cache");

const responseCache = createResponseCache();
const api = axios.create({
  timeout: 8000,
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 64 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 64 }),
});

const app = express();

app.use(
  compression({
    threshold: 1024, // 1KB 이상만 압축
  }),
);

/**
 * API 요청 실패 시 대체 행동
 * @param {Request} req request 객체
 * @returns
 */
async function executeFallbackAction(req) {
  const { ITEM_SEQ } = req.query;
  const baseUrl = `https://nedrug.mfds.go.kr/pbp/cmn/xml/drb/${ITEM_SEQ}`;
  try {
    // 대체 url 의약품안전나라
    const [EE, UD, NB] = await Promise.all([
      api.get(`${baseUrl}/EE`),
      api.get(`${baseUrl}/UD`),
      api.get(`${baseUrl}/NB`),
    ]);

    const nedrugData = {
      EE_DOC_DATA: EE.data,
      UD_DOC_DATA: UD.data,
      NB_DOC_DATA: NB.data,
    };

    return { success: true, data: nedrugData };
  } catch (e) {
    console.log("Temp Url Error", e.stack || e);

    return { success: false, data: {} };
  }
}

/**
 * 서비스 사용 불가 시 대체 XML 반환
 * @returns
 */
function getServiceDisableXML() {
  return {
    EE_DOC_DATA:
      '<DOC title="">\r\n<SECTION title=" &#8251 공공데이터 포털 장애로 인해 상세 정보를 표시할 수 없습니다.">\r\n<ARTICLE title="">\r\n</ARTICLE>\r\n</SECTION>\r\n</DOC>',
    UD_DOC_DATA:
      '<DOC title="">\r\n<SECTION title=" &#8251 공공데이터 포털 장애로 인해 상세 정보를 표시할 수 없습니다.">\r\n<ARTICLE title="">\r\n</ARTICLE>\r\n</SECTION>\r\n</DOC>',
    NB_DOC_DATA:
      '<DOC title="">\r\n<SECTION title=" &#8251 공공데이터 포털 장애로 인해 상세 정보를 표시할 수 없습니다.">\r\n<ARTICLE title="">\r\n</ARTICLE>\r\n</SECTION>\r\n</DOC>',
  };
}

/**
 * API 요청
 * @param {Request} req request 객체
 * @returns
 */
async function requestToAPI(req) {
  try {
    const { ITEM_SEQ } = req.query;
    const { API_URL, ENC_SERVICE_KEY } = process.env;

    if (!ITEM_SEQ) {
      throw new Error(`Invalid query ${ITEM_SEQ}`);
    }

    const result = await api.get(
      `${API_URL}&serviceKey=${ENC_SERVICE_KEY}&item_seq=${encodeURIComponent(ITEM_SEQ)}`,
    );

    const drugDetail = result?.data?.body?.items?.[0];

    if (!drugDetail) {
      console.log("Invalid response %s", result?.data?.body);
      throw new Error(`Invalid response`);
    }

    return { data: drugDetail, cacheable: true };
  } catch (e) {
    console.log("Standard API Error", e.stack || e);

    const fallbackResult = await executeFallbackAction(req);

    if (fallbackResult.success) {
      return { data: fallbackResult.data, cacheable: true };
    }

    if (axios.isAxiosError(e)) {
      return { data: getServiceDisableXML(), cacheable: false };
    }

    throw e;
  }
}

app.get("/", async (req, res, next) => {
  if (!authenticate(req)) {
    res.sendStatus(401);
    return;
  }

  if (typeof req.query.ITEM_SEQ !== "string" || !/^\d+$/.test(req.query.ITEM_SEQ)) {
    res.status(400).send("Invalid ITEM_SEQ");
    return;
  }

  try {
    const result = await responseCache.getOrLoad(req.query.ITEM_SEQ, async () => {
      const { data, cacheable } = await requestToAPI(req);
      return { body: JSON.stringify(data), cacheable };
    });
    res.set("Cache-Control", result.cacheable ? `private, max-age=${Math.max(0, CACHE_SECONDS - result.age)}` : "no-store");
    res.set("X-Cache-Status", result.hit ? "HIT" : "MISS");
    res.status(200).type("json").send(result.body);
  } catch (error) {
    next(error);
  }
});

functions.http("wip-pill-detail", app);
