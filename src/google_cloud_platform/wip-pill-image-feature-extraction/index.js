require("dotenv").config();
const functions = require("@google-cloud/functions-framework");
const compression = require("compression");
const express = require("express");
const { authenticate } = require("./authentication");
const { requestDetectImageGemini } = require("./gemini");

const app = express();

app.use(
  compression({
    threshold: 1024, // 1KB 이상만 압축
  }),
);

/**
 * 이미지 특징 추출 요청
 * @param {Request} req
 * @returns
 */
async function requestDetectImage(req) {
  const result = await requestDetectImageGemini(req.body.base64);

  console.log(
    "gemini result",
    JSON.stringify(result.response.candidates[0], null, 2),
  );

  const response =
    result.response.candidates[0].content.parts[0].functionCall.args;

  return response;
}

app.post("/", async (req, res) => {
  if (!authenticate(req)) {
    res.sendStatus(401);
    return;
  }

  const apiVersion = parseInt(req.headers.apiversion, 10);

  if (apiVersion === 2) {
    const response = await requestDetectImage(req);
    res.status(200).json(response);
  } else {
    res.status(403).send("Invalid API version");
  }
});

functions.http("wip-pill-image-feature-extraction", app);
