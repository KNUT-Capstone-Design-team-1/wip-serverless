const { Type, GoogleGenAI, ThinkingLevel } = require("@google/genai");

const textPart = {
  text: "Analyze the features of the pill in the provided image(s) (print, shape, and color) and respond in JSON format. If no pill is found or a feature cannot be identified, you must return an empty array `[]` for the corresponding field as required by the schema.",
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    PRINT_FRONT: {
      type: Type.STRING,
      description:
        "첫번째 이미지에 있는 알약의 각인(글자, 숫자, 기호). 90% 이상의 신뢰도를 가진 텍스트만 포함됩니다.",
    },
    PRINT_BACK: {
      type: Type.STRING,
      description:
        "두번째 이미지에 있는 알약의 각인(글자, 숫자, 기호). 90% 이상의 신뢰도를 가진 텍스트만 포함됩니다.",
    },
    SHAPE: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
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
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
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
  required: ["PRINT_FRONT", "PRINT_BACK", "SHAPE", "COLOR"],
  description: "이미지에서 추출한 알약의 상세 정보",
};

const systemPrompt = {
  text: `You are an expert AI model specializing in pharmaceutical pill identification.
  Your task is to analyze the provided pill image(s) and extract its key features. The images provide different views of the same pill (e.g., front and back).
  
  Follow these instructions precisely for each field defined in the output schema:
  
  1. **PRINT_FRONT**:
    - Analyze all provided views of the pill to identify any imprinted text, numbers, or symbols.
    - Only include markings where your recognition confidence is 90% or higher.
  
  2. **PRINT_BACK**:
    - Analyze all provided views of the pill to identify any imprinted text, numbers, or symbols.
    - Only include markings where your recognition confidence is 90% or higher.
  
  3. **SHAPE**:
    - Identify all plausible shapes for the pill based on all views.
    - Remember that viewing angles can be misleading (e.g., an 'oblong' pill might also appear 'oval').
  
  4. **COLOR**:
    - Identify all plausible colors for the pill based on all views.
    - Remember that lighting and shadows can affect color perception.
  
  **Important:**
  - Generate your output strictly according to the attached structured output schema.
  - If no pill is found in the images, or if a specific attribute is not present (e.g., no print), you must provide an empty list \`[]\` for the corresponding field as required by the schema.`,
};

const vertexai = new GoogleGenAI({
  project: process.env.PROJECT,
  location: process.env.LOCATION,
  vertexai: true,
});

/**
 * 제미나이 API에 특징 추출 요청
 * @param {Object} data 이미지 데이터 (base64 코드 포함)
 *   - { front: string, back: string }
 * @returns
 */
async function requestDetectImageGemini(data) {
  const parts = [textPart];

  parts.push({ inlineData: { data: data.front, mimeType: "image/jpeg" } });
  parts.push({ inlineData: { data: data.back, mimeType: "image/jpeg" } });

  const request = {
    model: process.env.MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: { parts: [systemPrompt] },
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      temperature: 0.6,
      topP: 0.95,
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.MINIMAL,
      },
    },
  };

  const result = await vertexai.models.generateContent(request);

  return result.text;
}

module.exports = { requestDetectImageGemini };
