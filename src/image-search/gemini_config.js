const {
  VertexAI,
  FunctionDeclarationSchemaType,
} = require("@google-cloud/vertexai");

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

const systemPrompt = {
  text: `You are an expert AI model specializing in pharmaceutical pill identification.
  Your task is to analyze the provided pill image and extract its key features. The image contains two views of the same pill (front and back).
  
  Follow these instructions precisely for each field defined in the output schema:
  
  1. **PRINT**:
    - Analyze both sides of the pill to identify any imprinted text, numbers, or symbols.
    - Only include markings where your recognition confidence is 90% or higher.
  
  2. **SHAPE**:
    - Identify all plausible shapes for the pill.
    - Remember that viewing angles can be misleading (e.g., an 'oblong' pill might also appear 'oval').
  
  3. **COLOR**:
    - Identify all plausible colors for the pill.
    - Remember that lighting and shadows can affect color perception.
  
  **Important:**
  - Generate your output strictly according to the attached structured output schema.
  - If no pill is found in the image, or if a specific attribute is not present (e.g., no print), you must provide an empty list \`[]\` for the corresponding field as required by the schema.`,
};

const vertexai = new VertexAI({
  project: process.env.PROJECT,
  location: process.env.LOCATION,
});

const geminiModel = vertexai.getGenerativeModel({
  model: process.env.MODEL,
  thinkingConfig: {
    thinkingLevel: "MEDIUM",
  },
  systemInstruction: {
    parts: [systemPrompt],
  },
});

module.exports = { geminiModel, responseSchema };
