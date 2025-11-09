// deploy-commands.js
import "dotenv/config";
import { REST, Routes } from "discord.js";
import { data as factData } from "./commands/fact.js";
import { data as statsData } from "./commands/stats.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

console.log("🧩 Using environment:", {
  CLIENT_ID,
  GUILD_ID,
  TOKEN_PRESENT: !!TOKEN,
});

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing one or more env vars: DISCORD_TOKEN, CLIENT_ID, GUILD_ID.");
  process.exit(1);
}

const commands = [factData.toJSON(), statsData.toJSON()];
console.log("🧱 Commands to deploy:", commands.map((c) => c.name));

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("🚀 Deploying slash commands to guild...");
    const data = await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("✅ Slash commands deployed:", data.map((c) => c.name));
  } catch (err) {
    console.error("❌ Deployment error:", err.rawError || err);
  }
})();
