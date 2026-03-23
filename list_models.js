const Groq = require("groq-sdk");
require("dotenv").config({ path: "./backend/.env" });

async function main() {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  try {
    const models = await groq.models.list();
    console.log(JSON.stringify(models, null, 2));
  } catch (err) {
    console.error(err);
  }
}
main();
