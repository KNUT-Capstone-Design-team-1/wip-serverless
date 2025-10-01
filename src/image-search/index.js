require("dotenv").config();
const functions = require("@google-cloud/functions-framework");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const fs = require("fs");
const path = require("path");
const NodeRSA = require("node-rsa");
const { GoogleAuth } = require("google-auth-library");
const { geminiModel, responseSchema, textPart } = require("./gemini_config");

/**
 * auth header로 부터 토큰을 추출
 * @param {String} authHeader
 * @returns
 */
function getToken(authHeader) {
  return authHeader.startsWith("Bearer ")
    ? authHeader.substring(7, authHeader.length)
    : null;
}

/**
 * 토큰 인증
 * @param {String} token 토큰 (base64)
 * @returns
 */
function authenticateRSA(token) {
  const rsaPrvKey = fs.readFileSync(
    path.join(__dirname, "./rsa_prv_key"),
    "utf-8"
  );

  const encryptDate = new NodeRSA(rsaPrvKey).decrypt(token, "utf8");

  dayjs.extend(utc);
  const now = dayjs.utc();
  const expireDate = dayjs.utc(encryptDate).add(10, "minute");

  return now.isBefore(expireDate);
}

/**
 * 토큰 인증
 * @param {Request} req
 * @returns
 */
function authenticate(req) {
  const token = getToken(req.headers.authorization);
  if (!token) {
    return false;
  }

  const authenticate = authenticateRSA(token);
  if (!authenticate) {
    return false;
  }

  return true;
}

/**
 * 구글 서비스 인스턴스를 반환
 * @param {String} serviceURL
 * @returns
 */
async function getGoogleIdTokenClient(serviceURL) {
  const googleAuth = new GoogleAuth({
    keyFilename: path.join(__dirname, "./google_service_key.json"),
  });

  return googleAuth.getIdTokenClient(serviceURL);
}

/**
 * 딥러닝 서버에 요청
 * @param {Request} req
 * @returns
 */
async function requestDLServer(req) {
  try {
    const { base64 } = req.body;
    const serviceURL = process.env.GOOGLE_CLOUD_DL_SERVER_URL;

    const client = await getGoogleIdTokenClient(serviceURL);

    const result = client.request({
      url: serviceURL,
      method: "POST",
      data: { base64 },
      headers: { "Content-Type": "application/json" },
    });

    return result;
  } catch (e) {
    if (e.errors) {
      for (const e1 of e.errors) {
        console.log("Aggergate DLServer Error", e1.stack || e1);
      }
    } else {
      console.log("Standard DL Server Error", e.stack || e);
    }

    throw e;
  }
}

/**
 * Gemini 모델 서버 요청
 * @param {Request} req
 * @returns
 */
async function requestGemini(req) {
  const { base64 } = req.body;
  const filePart = { inline_data: { data: base64, mimeType: "image/jpeg" } };

  const request = {
    contents: [{ role: "user", parts: [textPart, filePart] }],
    tools: [{ functionDeclarations: [responseSchema] }],
  };

  const result = await geminiModel.generateContent(request);
  console.log(
    "gemini result",
    JSON.stringify(result.response.candidates[0], null, 2)
  );
  const response =
    result.response.candidates[0].content.parts[0].functionCall.args;

  return response;
}

functions.http("imageSearch", async (req, res) => {
  switch (req.method) {
    case "POST": {
      if (!authenticate(req)) {
        res.sendStatus(401);
        return;
      }

      const apiVersion = parseInt(req.headers.apiversion, 10);

      if (apiVersion === 2) {
        const response = await requestGemini(req);
        res.status(200).json(response);
      } else {
        const searchResult = await requestDLServer(req);
        res.status(searchResult.status).json(searchResult.data);
      }
      break;
    }

    default:
      res.sendStatus(405);
  }
});
