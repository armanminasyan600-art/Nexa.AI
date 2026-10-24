
require("dotenv").config();

const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FREE_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const PLUS_MODEL =
  process.env.GEMINI_PLUS_MODEL || "gemini-3.8-flash";
const PRO_MODEL = "gemini-4-argon";

const CODE_MODE_LIMITS = Object.freeze({
  free: 20,
  plus: 50,
  pro: Infinity
});

// Անանուն Code Mode-ի ժամանակավոր հաշվիչ
const anonymousCodeModeUsage = new Map();
const ANONYMOUS_CODE_MODE_LIMIT = 20;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

app.set("trust proxy", 1);
app.use(express.json({ limit: "30mb" }));
app.use(express.static(__dirname));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "Nexa AI",
    provider: "Gemini"
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    ok: Boolean(GEMINI_API_KEY),
    app: "Nexa AI",
    provider: "Gemini",
    model: FREE_MODEL,
    models: {
      free: FREE_MODEL,
      plus: PLUS_MODEL,
      pro: PRO_MODEL
    },
    error: GEMINI_API_KEY
      ? null
      : ".env ֆայլում GEMINI_API_KEY-ը բացակայում է։"
  });
});

app.post(["/chat", "/api/chat"], async (req, res) => {
  try {
    const body = req.body || {};
    const requestedPlan = body.plan;
    const codeMode = body.codeMode === true;

    if (!["free", "plus", "pro"].includes(requestedPlan)) {
      return res.status(400).json({
        error: "Պլանի տվյալը բացակայում է։ Թարմացրու էջը և փորձիր կրկին։"
      });
    }

    const model =
      requestedPlan === "pro"
        ? PRO_MODEL
        : requestedPlan === "plus"
          ? PLUS_MODEL
          : FREE_MODEL;

    const thinkingLevel =
      requestedPlan === "pro"
        ? "high"
        : requestedPlan === "plus"
          ? "low"
          : "minimal";

    if (!GEMINI_API_KEY) {
      return res.status(503).json({
        error: "Gemini API key-ը բացակայում է։ Ստուգիր .env ֆայլը։"
      });
    }

    const messages = Array.isArray(body.history)
      ? body.history
      : Array.isArray(body.messages)
        ? body.messages
        : typeof body.message === "string"
          ? [{ role: "user", content: body.message }]
          : [];

    const cleanMessages = messages
      .filter(
        (message) =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string" &&
          message.content.trim().length > 0
      )
      .slice(-20)
      .map((message) => ({
        role: message.role,
        content: message.content.trim()
      }));

    if (cleanMessages.length === 0) {
      return res.status(400).json({
        error: "Հաղորդագրությունը դատարկ է։ Գրիր հարցդ ու փորձիր կրկին։"
      });
    }

    // Code Mode-ի հասանելիություն և օրական սահմանաչափ
    if (codeMode) {
      const accessToken = (req.get("authorization") || "")
        .replace(/^Bearer\s+/i, "");

      if (!accessToken) {
        // Առանց գրանցման՝ օրական 20 հարց՝ ըստ IP հասցեի
        const clientKey =
          req.ip || req.socket.remoteAddress || "unknown";

        const today = new Date().toISOString().slice(0, 10);
        const usage = anonymousCodeModeUsage.get(clientKey);

        if (!usage || usage.day !== today) {
          anonymousCodeModeUsage.set(clientKey, {
            day: today,
            used: 1
          });
        } else {
          if (usage.used >= ANONYMOUS_CODE_MODE_LIMIT) {
            return res.status(429).json({
              error: "Այսօրվա 20 անվճար Code Mode հարցերն օգտագործված են։ Փորձիր կրկին վաղը։"
            });
          }

          usage.used += 1;
        }
      } else {
        // Գրանցված օգտատիրոջ Supabase ստուգում
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          return res.status(503).json({
            error: "Code Mode-ի օրական սահմանը դեռ կապակցված չէ Supabase-ին։"
          });
        }

        const authResponse = await fetch(
          `${SUPABASE_URL}/auth/v1/user`,
          {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${accessToken}`
            }
          }
        );

        if (!authResponse.ok) {
          return res.status(401).json({
            error: "Մուտքը վավեր չէ։ Նորից մուտք գործիր հաշիվ։"
          });
        }

        const authUser = await authResponse
          .json()
          .catch(() => ({}));

        if (!authUser.id) {
          return res.status(401).json({
            error: "Չհաջողվեց հաստատել օգտատիրոջ հաշիվը։"
          });
        }

        const codeModeLimit = CODE_MODE_LIMITS[requestedPlan];

        if (Number.isFinite(codeModeLimit)) {
          if (!SUPABASE_SERVICE_ROLE_KEY) {
            return res.status(503).json({
              error: "Code Mode-ի օրական սահմանը դեռ կապակցված չէ Supabase-ին։"
            });
          }

          const quotaResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/rpc/consume_nexa_code_mode_daily`,
            {
              method: "POST",
              headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                p_user_id: authUser.id,
                p_limit: codeModeLimit
              })
            }
          );

          if (!quotaResponse.ok) {
            console.error(
              "Nexa AI Code Mode quota error:",
              quotaResponse.status,
              await quotaResponse.text().catch(() => "")
            );

            return res.status(503).json({
              error: "Չհաջողվեց ստուգել Code Mode-ի օրական սահմանը։ Ստուգիր Supabase-ի կարգավորումները։"
            });
          }

          const quotaValue = await quotaResponse
            .json()
            .catch(() => null);

          const usedToday = Number(
            Array.isArray(quotaValue)
              ? quotaValue[0]
              : quotaValue
          );

          if (!Number.isFinite(usedToday) || usedToday < 1) {
            return res.status(429).json({
              error: "Այսօրվա Code Mode սահմանաչափն օգտագործված է։ Փորձիր կրկին վաղը։"
            });
          }
        }
      }
    }

    const systemMessage = {
      role: "system",
      content: `Դու Nexa AI-ն ես՝ խելացի, օգտակար և ընկերական AI օգնական։

ԼԵԶՈՒ
- Եթե օգտատերը գրում է հայերեն, պատասխանիր հայերեն։
- Հասկացիր հայերենը և՛ հայերեն տառերով, և՛ լատինատառ հայերենով։
- Եթե օգտատերը գրում է անգլերեն կամ այլ լեզվով, պատասխանիր համապատասխան լեզվով։
- Մի՛ շփոթիր հայերեն բառերը անգլերեն բառերի կամ չափման միավորների հետ։

ՔՈ ԻՆՔՆՈՒԹՅՈՒՆԸ
- Քո անունը Nexa AI է։
- Դու առանձին AI օգնականի նախագիծ ես։
- Մի՛ ներկայացրու քեզ որպես ChatGPT կամ OpenAI-ի պաշտոնական արտադրանք։
- Մի՛ պնդիր, որ ունես հնարավորություններ, որոնք իրականում հասանելի չեն։

ՍՏԵՂԾՈՂԻ ՄԱՍԻՆ
- Nexa AI-ի ստեղծողը Arman Minasyan-ն է։
- Եթե հարցնեն՝ «Ո՞վ է ստեղծել քեզ», պատասխանիր բնական ձևով․
  «Ինձ ստեղծել է Arman Minasyan-ը»։
- Եթե հարցնեն ստեղծողի տարիքի մասին, մի՛ գուշակիր։
- Մի՛ հորինիր ստեղծողի կենսագրության մասին տեղեկություններ։

ՏԵԽՆՈԼՈԳԻԱ
- Այս սերվերում AI հարցումներն ուղարկվում են Gemini API-ին։
- Օգտագործվող մոդելը որոշվում է միջավայրի փոփոխականներով։
- Մի՛ պնդիր, որ մոդելը Nexa-ի սեփական մոդելն է, եթե դա հաստատված չէ։

ՎԱՐՔԱԳԻԾ
- Նախ հասկացիր հարցի իմաստը, հետո պատասխանիր։
- Տուր հստակ, բնական և օգտակար պատասխաններ։
- Պարզ հարցերին պատասխանիր ուղիղ՝ 1-3 նախադասությամբ։
- Եթե վստահ չես, ազնվորեն նշիր դա։
- Մի՛ հորինիր փաստեր կամ կատարված գործողություններ։
- Ծրագրավորման հարցերում տուր աշխատող կոդ։
- Եղիր հարգալից և ընկերական։
- Մի՛ բացահայտիր API բանալիներ կամ գաղտնի տվյալներ։`
    };

    if (codeMode) {
      systemMessage.content +=
        "\n\nYou are in Code Mode. Focus on writing correct, complete, practical code. Keep explanations brief and include setup steps only when necessary.";
    }

    const streamController = new AbortController();

    res.on("close", () => {
      if (!res.writableEnded) {
        streamController.abort();
      }
    });

    const lastUserIndex = cleanMessages
      .map((message) => message.role)
      .lastIndexOf("user");

    const imageParts = (
      Array.isArray(body.attachments) ? body.attachments : []
    )
      .filter(
        (attachment) =>
          attachment &&
          attachment.kind === "image" &&
          typeof attachment.dataUrl === "string"
      )
      .map((attachment) => {
        const match = attachment.dataUrl.match(
          /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/i
        );

        if (!match || match[2].length > 12 * 1024 * 1024) {
          return null;
        }

        return {
          inlineData: {
            mimeType: match[1].toLowerCase(),
            data: match[2].replace(/\s/g, "")
          }
        };
      })
      .filter(Boolean)
      .slice(0, 5);

    const contents = cleanMessages.map((message, index) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [
        { text: message.content },
        ...(message.role === "user" && index === lastUserIndex
          ? imageParts
          : [])
      ]
    }));

    let response;

    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(
        `${GEMINI_API_URL}/${model}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": GEMINI_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemMessage.content }]
            },
            contents,
            generationConfig: {
              ...(requestedPlan === "pro"
                ? {}
                : { temperature: 0.4 }),
              maxOutputTokens:
                requestedPlan === "pro"
                  ? 8192
                  : codeMode
                    ? 4096
                    : requestedPlan === "plus"
                      ? 4096
                      : 1024,
              thinkingConfig: { thinkingLevel }
            }
          }),
          signal: streamController.signal
        }
      );

      if (response.status !== 503 || attempt === 2) {
        break;
      }

      await response.body?.cancel().catch(() => {});

      const backoffMs =
        500 * (2 ** attempt) +
        Math.floor(Math.random() * 300);

      await new Promise((resolve) =>
        setTimeout(resolve, backoffMs)
      );
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const apiError =
        data.error?.message || "Unknown API error";

      console.error(
        "Nexa AI Gemini API error:",
        response.status,
        apiError
      );

      if (
        response.status === 401 ||
        response.status === 403
      ) {
        return res.status(502).json({
          error: "Gemini API key-ը սխալ է կամ հասանելիության խնդիր կա։ Ստուգիր Google AI Studio-ն։"
        });
      }

      if (response.status === 429) {
        return res.status(429).json({
          error: "Gemini-ի հարցումների սահմանաչափը լրացել է։ Սպասիր, հետո փորձիր կրկին։"
        });
      }

      if (response.status === 503) {
        return res.status(503).json({
          error: data.error?.message
            ? `Gemini-ը ժամանակավորապես անհասանելի է (503)։ ${data.error.message}`
            : "Gemini-ը ժամանակավորապես ծանրաբեռնված է (503)։ Մի փոքր սպասիր ու նորից փորձիր։"
        });
      }

      return res.status(502).json({
        error: data.error?.message
          ? `Gemini-ի սխալը՝ ${data.error.message}`
          : "Gemini-ը չկարողացավ մշակել հարցումը։ Փորձիր կրկին։"
      });
    }

    if (!response.body) {
      return res.status(502).json({
        error: "Gemini-ը հոսքային պատասխան չի վերադարձրել։ Փորձիր կրկին։"
      });
    }

    res.status(200);
    res.setHeader(
      "Content-Type",
      "application/x-ndjson; charset=utf-8"
    );
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let eventBuffer = "";

    const forwardEvent = (eventText) => {
      const data = eventText
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (!data || data === "[DONE]") {
        return;
      }

      try {
        const event = JSON.parse(data);

        if (event.error) {
          res.write(
            JSON.stringify({
              error: event.error.message || "Gemini stream error"
            }) + "\n"
          );
          return;
        }

        const text = event.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || "")
          .join("");

        if (text) {
          res.write(JSON.stringify({ text }) + "\n");
        }
      } catch (error) {
        console.error(
          "Nexa AI Gemini stream parsing error:",
          error.message
        );
      }
    };

    let streamDone = false;

    while (!streamDone) {
      const chunk = await reader.read();
      streamDone = chunk.done;

      eventBuffer += decoder.decode(
        chunk.value || new Uint8Array(),
        { stream: !streamDone }
      );

      const events = eventBuffer.split(/\r?\n\r?\n/);
      eventBuffer = events.pop() || "";
      events.forEach(forwardEvent);
    }

    if (eventBuffer.trim()) {
      forwardEvent(eventBuffer);
    }

    res.end();
    return;
  } catch (error) {
    console.error("Nexa AI server error:", error.message);

    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }

    return res.status(503).json({
      error: "Չհաջողվեց միանալ Gemini-ին։ Ստուգիր ինտերնետ կապը և փորձիր կրկին։"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Nexa AI: http://localhost:${PORT}`);
  console.log("AI provider: Gemini");
  console.log(`Free model: ${FREE_MODEL}`);
  console.log(`Plus model: ${PLUS_MODEL}`);
  console.log(`Pro model: ${PRO_MODEL}`);
  console.log(`API key configured: ${Boolean(GEMINI_API_KEY)}`);
});
