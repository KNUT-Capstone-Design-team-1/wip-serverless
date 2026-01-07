require("dotenv").config();
const functions = require("@google-cloud/functions-framework");
const { authenticate } = require("./authentication");
const { geminiModel, responseSchema, textPart } = require("./gemini_config");

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
        res.sendStatus(403);
      }
      break;
    }

    default:
      res.sendStatus(405);
  }
});
