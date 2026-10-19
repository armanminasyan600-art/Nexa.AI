
require("dotenv").config();

const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

// Nexa AI սերվերի կարգավիճակ
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "Nexa AI",
    provider: "Groq"
  });
});

// API կարգավիճակ
app.get("/api/status", (req, res) => {
  res.json({
    ok: Boolean(GROQ_API_KEY),
    app: "Nexa AI",
    provider: "Groq",
    model: MODEL,
    error: GROQ_API_KEY
      ? null
      : ".env ֆայլում GROQ_API_KEY-ը բացակայում է։"
  });
});

// Հիմնական AI չատ
app.post(["/chat", "/api/chat"], async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      return res.status(503).json({
        error: "Groq API key-ը բացակայում է։ Ստուգիր .env ֆայլը։"
      });
    }

    const body = req.body || {};

    const messages = Array.isArray(body.messages)
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
      .slice(-40)
      .map((message) => ({
        role: message.role,
        content: message.content.trim()
      }));

    if (cleanMessages.length === 0) {
      return res.status(400).json({
        error: "Հաղորդագրությունը դատարկ է։ Գրիր հարցդ ու փորձիր կրկին։"
      });
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
- Եթե հարցնեն ստեղծողի տարիքի մասին, մի՛ գուշակիր և մի՛ ներկայացրու չստուգված տարիքը որպես հաստատված փաստ։
- Մի՛ հորինիր ստեղծողի կենսագրության, աշխատանքի կամ նախագծի պատմության մասին տեղեկություններ։

ՏԵԽՆՈԼՈԳԻԱ
- Այս սերվերի տարբերակում AI հարցումներն ուղարկվում են Groq API-ին։
- Օգտագործվող մոդելը որոշվում է GROQ_MODEL միջավայրի փոփոխականով։
- Եթե հարցնեն՝ ինչ տեխնոլոգիայով ես աշխատում, պատասխանիր այս տեղեկությունների հիման վրա։
- Մի՛ պնդիր, որ մոդելը Nexa-ի սեփական մոդելն է, եթե դա հաստատված չէ։

ՎԱՐՔԱԳԻԾ
- Նախ հասկացիր հարցի իմաստը, հետո պատասխանիր։
- Տուր հստակ, բնական և օգտակար պատասխաններ։
- Պարզ հարցերին պատասխանիր կարճ, բարդ հարցերին՝ մանրամասն։
- Եթե վստահ չես, ազնվորեն նշիր դա։
- Մի՛ հորինիր փաստեր, աղբյուրներ կամ կատարված գործողություններ։
- Եթե հարցը երկիմաստ է, անհրաժեշտության դեպքում խնդրիր պարզաբանում։
- Ծրագրավորման հարցերում տուր աշխատող կոդ և բացատրիր՝ որտեղ տեղադրել այն։
- Եղիր հարգալից, համբերատար և ընկերական։
- Մի՛ բացահայտիր API բանալիներ կամ գաղտնի տվյալներ։`
    };

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [systemMessage, ...cleanMessages],
        temperature: 0.4,
        max_tokens: 2048,
        stream: false
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        "Nexa AI Groq API error:",
        response.status,
        data.error?.message || "Unknown API error"
      );

      if (response.status === 401 || response.status === 403) {
        return res.status(502).json({
          error: "Groq API key-ը սխալ է կամ հասանելիության խնդիր կա։ Ստուգիր Groq Console-ը։"
        });
      }

      if (response.status === 429) {
        return res.status(429).json({
          error: "Groq-ի հարցումների սահմանաչափը լրացել է։ Սպասիր, հետո փորձիր կրկին։"
        });
      }

      return res.status(502).json({
        error: data.error?.message
          ? `Groq-ի սխալը՝ ${data.error.message}`
          : "Groq-ը չկարողացավ մշակել հարցումը։ Փորձիր կրկին։"
      });
    }

    const reply = data.choices?.[0]?.message?.content;

    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(502).json({
        error: "Nexa AI-ն դատարկ պատասխան է վերադարձրել։ Փորձիր կրկին։"
      });
    }

    return res.json({
      reply,
      choices: [
        {
          message: {
            role: "assistant",
            content: reply
          }
        }
      ]
    });
  } catch (error) {
    console.error("Nexa AI server error:", error.message);

    return res.status(503).json({
      error: "Չհաջողվեց միանալ Groq-ին։ Ստուգիր ինտերնետ կապը և փորձիր կրկին։"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Nexa AI: http://localhost:${PORT}`);
  console.log("AI provider: Groq");
  console.log(`AI model: ${MODEL}`);
  console.log(`API key configured: ${Boolean(GROQ_API_KEY)}`);
});