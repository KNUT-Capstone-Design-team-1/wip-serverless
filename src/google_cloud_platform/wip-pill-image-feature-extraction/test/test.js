const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

async function test() {
    const imagePath = path.join(__dirname, "pill_test.jpg"); // 절대 경로 사용

    // 1. 파일 존재 여부 확인
    if (!fs.existsSync(imagePath)) {
        console.error(`에러: 이미지를 찾을 수 없습니다. 경로: ${imagePath}`);
        return;
    }

    const imageBase64 = fs.readFileSync(imagePath, { encoding: "base64" });

    console.log("Gemini 요청 중...");

    const startTime = performance.now();
    try {
        const response = await axios.post(
            "http://localhost:8080",
            {
                base64: imageBase64,
            },
            {
                headers: { apiversion: "2" },
            },
        );

        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);

        console.log("--- 결과 ---");
        console.log(JSON.stringify(response.data, null, 2));

        console.log("---------------------------");
        console.log(
            `⏱️ 응답 시간: ${duration}ms (${(duration / 1000).toFixed(2)}초)`,
        );
        console.log("---------------------------");
    } catch (error) {
        const endTime = performance.now();
        console.log("--- 에러 상세 ---");
        // error.response가 없는 경우(서버 미실행 등)도 대비
        if (error.response) {
            console.error("서버 응답 에러:", error.response.data);
        } else {
            console.error("요청 에러:", error.message);
        }
        console.log(
            `⏱️ 에러 발생까지 걸린 시간: ${(endTime - startTime).toFixed(2)}ms`,
        );
    }
}

test();
