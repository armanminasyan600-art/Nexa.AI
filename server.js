
import "dotenv/config";
import express from "express";
import cors from "cors";

async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetchWithRetry(url, options);

      if (
        response.status !== 503 &&
        response.status !== 429 &&
        response.status < 500
      ) {
        return response;
      }

      if (attempt >= retries) return response;
    } catch (error) {
      if (attempt >= retries) throw error;
    }

    const delay = 1000 * 2 ** attempt;
    console.log(`Կրկին փորձ՝ ${attempt + 1}/${retries}, ${delay}ms հետո`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("."));

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log("Gemini API key loaded:", Boolean(GEMINI_API_KEY));

app.post("/api/chat", async (req, res) => {
  try {
    const prompt = req.body?.message || req.body?.prompt;

    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({
        error: "Գրիր քո հարցը։",
      });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY-ը կարգավորված չէ սերվերում։",
      });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt.trim() }],
            },
          ],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", response.status, data);

      return res.status(502).json({
        error: "Gemini-ի հարցումը չհաջողվեց։",
      });
    }

    const answer = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n")
      .trim();

    if (!answer) {
      console.error("Gemini returned no text:", data);

      return res.status(502).json({
        error: "Gemini-ն պատասխան չվերադարձրեց։",
      });
    }

    return res.json({
      answer,
      text: answer,
    });
  } catch (error) {
    console.error("Chat error:", error);

    return res.status(500).json({
      error: "Սերվերի սխալ։ Փորձիր կրկին։",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Nexa AI server running on http://localhost:${PORT}`);
});
