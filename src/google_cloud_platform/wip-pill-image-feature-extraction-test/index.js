require("dotenv").config();
const functions = require("@google-cloud/functions-framework");
const compression = require("compression");
const express = require("express");
const { authenticate } = require("./authentication");
const { requestDetectImageGemini } = require("./gemini");
const { prepareImages } = require("./image");
const { CACHE_SECONDS, createResponseCache } = require("./cache");
const responseCache = createResponseCache({ maxBytes: 4 * 1024 * 1024 });

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
async function requestDetectImage(images) {
  const resultText = await requestDetectImageGemini(images);

  const response = JSON.parse(resultText);

  return response;
}

app.post("/", async (req, res, next) => {
  if (!authenticate(req)) {
    res.sendStatus(401);
    return;
  }

  const apiVersion = parseInt(req.headers.apiversion, 10);

  if (apiVersion === 2) {
    let prepared;
    try {
      prepared = prepareImages(req.body, process.env.MODEL);
    } catch (error) {
      res.status(400).send(error.message);
      return;
    }
    try {
      const result = await responseCache.getOrLoad(prepared.key, async () => ({
        body: JSON.stringify(await requestDetectImage(prepared.images)),
      }));
      // POST bodies are not HTTP cache keys; reuse is keyed by the image hash above.
      res.set("Cache-Control", `private, max-age=${Math.max(0, CACHE_SECONDS - result.age)}`);
      res.vary("apiversion");
      res.set("X-Cache-Status", result.hit ? "HIT" : "MISS");
      res.status(200).type("json").send(result.body);
    } catch (error) {
      next(error);
    }
  } else {
    res.status(403).send("Invalid API version");
  }
});

functions.http("wip-pill-image-feature-extraction-test", app);
