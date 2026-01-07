require("dotenv").config();
const functions = require("@google-cloud/functions-framework");
const { FunctionDeclarationSchemaType } = require("@google-cloud/vertexai");
const { authenticate } = require("./authentication");
const { geminiModel } = require("./gemini_config");

/**
 * 제미나이 API에 보낼 request body 반환
 * @param {String} base64 이미지 base64 코드
 * @returns
 */
function getGeminiRequest(base64) {
  const filePart = { inline_data: { data: base64, mimeType: "image/jpeg" } };

  const textPart = {
    text: "Analyze the features of the pill in this image (print, shape, and color) and respond in JSON format. If no pill is found or a feature cannot be identified, you must return an empty array `[]` for the corresponding field as required by the schema.",
  };

  const responseSchema = {
    name: "Pill_Info_Extractor",
    description: "Extract information about a pill from an image",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        PRINT: {
          type: FunctionDeclarationSchemaType.ARRAY,
          items: {
            type: FunctionDeclarationSchemaType.STRING,
          },
          description:
            "알약의 각인(글자, 숫자, 기호) 목록. 90% 이상의 신뢰도를 가진 텍스트만 포함됩니다.",
        },
        SHAPE: {
          type: FunctionDeclarationSchemaType.ARRAY,
          items: {
            type: FunctionDeclarationSchemaType.STRING,
            enum: [
              "원형",
              "타원형",
              "장방형",
              "반원형",
              "삼각형",
              "사각형",
              "마름모형",
              "오각형",
              "육각형",
              "팔각형",
              "기타",
            ],
          },
          description:
            "인식된 알약의 모양 목록. 여러 각도를 고려하여 가능한 모든 모양이 포함될 수 있습니다.",
        },
        COLOR: {
          type: FunctionDeclarationSchemaType.ARRAY,
          items: {
            type: FunctionDeclarationSchemaType.STRING,
            enum: [
              "하양",
              "노랑",
              "주황",
              "분홍",
              "빨강",
              "갈색",
              "연두",
              "초록",
              "청록",
              "파랑",
              "남색",
              "자주",
              "보라",
              "회색",
              "검정",
              "투명",
            ],
          },
          description:
            "인식된 알약의 색상 목록. 조명에 따라 가능한 모든 색상이 포함될 수 있습니다.",
        },
      },
      required: ["PRINT", "SHAPE", "COLOR"],
      description: "이미지에서 추출한 알약의 상세 정보",
    },
  };

  return {
    contents: [{ role: "user", parts: [textPart, filePart] }],
    tools: [{ functionDeclarations: [responseSchema] }],
  };
}

/**
 * Gemini 모델 서버 요청
 * @param {Request} req
 * @returns
 */
async function requestGemini(req) {
  const request = getGeminiRequest(req.body.base64);

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
