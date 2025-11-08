// deploy-commands.js
import "dotenv/config";
import { REST, Routes } from "discord.js";
import { data as factData } from "./commands/fact.js";
import { data as statsData } from "./commands/stats.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // your app (bot) ID
const GUILD_ID = process.env.GUILD_ID;   // your dev server ID

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("DISCORD_TOKEN, CLIENT_ID, and GUILD_ID must be set in env.");
  process.exit(1);
}

const commands = [factData.toJSON(), statsData.toJSON()];

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("🚀 Deploying guild slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("✅ Slash commands deployed to guild:", GUILD_ID);
  } catch (err) {
    console.error("Failed to deploy commands:", err);
  }
})();
