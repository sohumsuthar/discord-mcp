#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  EmbedBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DEFAULT_CHANNEL_ID = process.env.DISCORD_DEFAULT_CHANNEL_ID || null;

// Multi-guild support: DISCORD_GUILDS is a JSON object mapping alias -> guild ID
// e.g. {"personal":"755496428683526276","checkpoint":"1476449580521361621"}
let GUILDS = {};
try {
  GUILDS = JSON.parse(process.env.DISCORD_GUILDS || "{}");
} catch {
  GUILDS = {};
}

// Fallback: single guild mode
const LEGACY_GUILD_ID = process.env.DISCORD_GUILD_ID;
if (LEGACY_GUILD_ID && Object.keys(GUILDS).length === 0) {
  GUILDS.default = LEGACY_GUILD_ID;
}

// Default guild alias (first one, or "personal" if it exists)
const DEFAULT_GUILD_ALIAS = GUILDS.personal
  ? "personal"
  : Object.keys(GUILDS)[0] || "default";

// User mappings: name -> discord user ID
let USER_MAPPINGS = {};
try {
  USER_MAPPINGS = JSON.parse(process.env.DISCORD_USER_MAPPINGS || "{}");
} catch {
  USER_MAPPINGS = {};
}

// Discord client
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let discordReady = false;

discord.once("ready", () => {
  discordReady = true;
  console.error(`Discord bot logged in as ${discord.user.tag}`);
  console.error(
    `Connected guilds: ${[...discord.guilds.cache.values()].map((g) => g.name).join(", ")}`
  );
});

discord.login(DISCORD_TOKEN).catch((err) => {
  console.error("Failed to login to Discord:", err.message);
});

// Helper: wait for discord to be ready
async function waitForDiscord(timeoutMs = 15000) {
  if (discordReady) return;
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (discordReady) return resolve();
      if (Date.now() - start > timeoutMs)
        return reject(new Error("Discord client not ready (timeout)"));
      setTimeout(check, 200);
    };
    check();
  });
}

// Helper: resolve guild by alias or ID
function resolveGuild(serverAlias) {
  if (!serverAlias) {
    const guildId = GUILDS[DEFAULT_GUILD_ALIAS];
    const guild = discord.guilds.cache.get(guildId);
    if (guild) return guild;
    throw new Error(
      `Default guild "${DEFAULT_GUILD_ALIAS}" (${guildId}) not found`
    );
  }

  // Try as alias first
  const aliasLower = serverAlias.toLowerCase();
  const guildId = GUILDS[aliasLower];
  if (guildId) {
    const guild = discord.guilds.cache.get(guildId);
    if (guild) return guild;
    throw new Error(`Guild alias "${serverAlias}" (${guildId}) not found`);
  }

  // Try as raw guild ID
  if (/^\d+$/.test(serverAlias)) {
    const guild = discord.guilds.cache.get(serverAlias);
    if (guild) return guild;
  }

  // Try matching guild name
  const guild = discord.guilds.cache.find(
    (g) => g.name.toLowerCase() === aliasLower
  );
  if (guild) return guild;

  throw new Error(
    `Server "${serverAlias}" not found. Available: ${Object.keys(GUILDS).join(", ")}`
  );
}

// Helper: resolve channel by ID or name within a guild
async function resolveChannel(channelIdOrName, guild) {
  // Try by ID first
  let channel = guild.channels.cache.get(channelIdOrName);
  if (channel) return channel;

  // Try by name
  const cleanName = channelIdOrName.replace(/^#/, "").toLowerCase();
  channel = guild.channels.cache.find(
    (c) => c.name.toLowerCase() === cleanName && c.isTextBased()
  );
  if (channel) return channel;

  // Fetch and retry
  await guild.channels.fetch();
  channel = guild.channels.cache.get(channelIdOrName);
  if (channel) return channel;
  channel = guild.channels.cache.find(
    (c) => c.name.toLowerCase() === cleanName && c.isTextBased()
  );
  if (channel) return channel;

  throw new Error(`Channel "${channelIdOrName}" not found in ${guild.name}`);
}

// Helper: resolve channel with server context
async function resolveChannelWithServer(channelArg, serverArg) {
  await waitForDiscord();
  const guild = resolveGuild(serverArg);
  if (channelArg) {
    return await resolveChannel(channelArg, guild);
  }
  if (DEFAULT_CHANNEL_ID) {
    // Default channel might be in a different guild, try it
    for (const g of discord.guilds.cache.values()) {
      const ch = g.channels.cache.get(DEFAULT_CHANNEL_ID);
      if (ch) return ch;
    }
  }
  throw new Error("No channel specified and no default channel set");
}

// Helper: resolve user for DM
async function resolveUser(nameOrId) {
  await waitForDiscord();

  const mappedId = USER_MAPPINGS[nameOrId.toLowerCase()];
  if (mappedId) {
    try {
      return await discord.users.fetch(mappedId);
    } catch {
      throw new Error(
        `Mapped user "${nameOrId}" (ID: ${mappedId}) not found`
      );
    }
  }

  if (/^\d+$/.test(nameOrId)) {
    try {
      return await discord.users.fetch(nameOrId);
    } catch {
      throw new Error(`User with ID ${nameOrId} not found`);
    }
  }

  // Search across all guilds
  for (const [, guildId] of Object.entries(GUILDS)) {
    const guild = discord.guilds.cache.get(guildId);
    if (!guild) continue;
    const members = await guild.members.fetch({ query: nameOrId, limit: 5 });
    const match = members.find(
      (m) =>
        m.user.username.toLowerCase() === nameOrId.toLowerCase() ||
        m.displayName.toLowerCase() === nameOrId.toLowerCase() ||
        m.user.globalName?.toLowerCase() === nameOrId.toLowerCase()
    );
    if (match) return match.user;
  }

  throw new Error(`User "${nameOrId}" not found`);
}

function formatCodeBlock(code, language = "") {
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

const SERVER_PARAM = {
  type: "string",
  description:
    'Server alias or name (e.g. "personal", "checkpoint"). Defaults to personal server if not specified.',
};

// MCP Server
const server = new Server(
  { name: "discord-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "discord_send_message",
      description:
        'Send a text message to a Discord channel. Specify server alias (e.g. "personal", "checkpoint") and channel name or ID.',
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The message text to send" },
          channel: {
            type: "string",
            description: "Channel name or ID (optional, uses default if not set)",
          },
          server: SERVER_PARAM,
        },
        required: ["message"],
      },
    },
    {
      name: "discord_send_code",
      description:
        "Send a formatted code snippet to a Discord channel with syntax highlighting.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "The code to send" },
          language: {
            type: "string",
            description: "Programming language for syntax highlighting",
          },
          title: {
            type: "string",
            description: "Optional title/description above the code block",
          },
          channel: { type: "string", description: "Channel name or ID" },
          server: SERVER_PARAM,
        },
        required: ["code"],
      },
    },
    {
      name: "discord_send_file",
      description: "Send a file from the local filesystem to a Discord channel.",
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file to send",
          },
          message: {
            type: "string",
            description: "Optional message to accompany the file",
          },
          channel: { type: "string", description: "Channel name or ID" },
          server: SERVER_PARAM,
        },
        required: ["file_path"],
      },
    },
    {
      name: "discord_send_image",
      description: "Send an image from the local filesystem to a Discord channel.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "Absolute path to the image file",
          },
          message: {
            type: "string",
            description: "Optional caption for the image",
          },
          channel: { type: "string", description: "Channel name or ID" },
          server: SERVER_PARAM,
        },
        required: ["image_path"],
      },
    },
    {
      name: "discord_send_dm",
      description:
        "Send a direct message to a Discord user by name, mapped alias, or user ID.",
      inputSchema: {
        type: "object",
        properties: {
          user: {
            type: "string",
            description: "Username, display name, mapped alias, or user ID",
          },
          message: { type: "string", description: "The message to send" },
          code: {
            type: "string",
            description: "Optional code snippet to include",
          },
          language: {
            type: "string",
            description: "Language for code highlighting",
          },
          file_path: {
            type: "string",
            description: "Optional file to attach",
          },
        },
        required: ["user", "message"],
      },
    },
    {
      name: "discord_list_channels",
      description:
        "List all text channels in a Discord server. Specify server alias to pick which server.",
      inputSchema: {
        type: "object",
        properties: {
          server: SERVER_PARAM,
        },
      },
    },
    {
      name: "discord_list_members",
      description: "List members of a Discord server.",
      inputSchema: {
        type: "object",
        properties: {
          server: SERVER_PARAM,
          limit: {
            type: "number",
            description: "Max members to return (default 50)",
          },
        },
      },
    },
    {
      name: "discord_list_servers",
      description:
        "List all configured Discord servers and their aliases.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "discord_add_user_mapping",
      description:
        "Add a friendly name mapping for a Discord user.",
      inputSchema: {
        type: "object",
        properties: {
          alias: {
            type: "string",
            description: 'The friendly name/alias (e.g. "john")',
          },
          user_id: {
            type: "string",
            description: "The Discord user ID to map to",
          },
        },
        required: ["alias", "user_id"],
      },
    },
    {
      name: "discord_read_messages",
      description: "Read recent messages from a Discord channel.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel name or ID" },
          server: SERVER_PARAM,
          limit: {
            type: "number",
            description: "Number of messages to fetch (default 10, max 50)",
          },
        },
        required: ["channel"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    await waitForDiscord();

    switch (name) {
      case "discord_send_message": {
        const channel = await resolveChannelWithServer(
          args.channel,
          args.server
        );
        const msg = args.message;
        if (msg.length <= 2000) {
          await channel.send(msg);
        } else {
          const chunks = msg.match(/[\s\S]{1,2000}/g);
          for (const chunk of chunks) {
            await channel.send(chunk);
          }
        }
        return {
          content: [
            {
              type: "text",
              text: `Message sent to #${channel.name} in ${channel.guild.name}`,
            },
          ],
        };
      }

      case "discord_send_code": {
        const channel = await resolveChannelWithServer(
          args.channel,
          args.server
        );
        const codeBlock = formatCodeBlock(args.code, args.language || "");
        const fullMessage = args.title
          ? `**${args.title}**\n${codeBlock}`
          : codeBlock;

        if (fullMessage.length > 2000) {
          const ext = args.language ? `.${args.language}` : ".txt";
          const attachment = new AttachmentBuilder(
            Buffer.from(args.code, "utf-8"),
            { name: `code${ext}` }
          );
          await channel.send({
            content: args.title ? `**${args.title}**` : undefined,
            files: [attachment],
          });
        } else {
          await channel.send(fullMessage);
        }
        return {
          content: [
            {
              type: "text",
              text: `Code snippet sent to #${channel.name} in ${channel.guild.name}`,
            },
          ],
        };
      }

      case "discord_send_file": {
        const channel = await resolveChannelWithServer(
          args.channel,
          args.server
        );
        const filePath = args.file_path;
        if (!fs.existsSync(filePath))
          throw new Error(`File not found: ${filePath}`);
        const attachment = new AttachmentBuilder(filePath);
        await channel.send({
          content: args.message || undefined,
          files: [attachment],
        });
        return {
          content: [
            {
              type: "text",
              text: `File "${path.basename(filePath)}" sent to #${channel.name} in ${channel.guild.name}`,
            },
          ],
        };
      }

      case "discord_send_image": {
        const channel = await resolveChannelWithServer(
          args.channel,
          args.server
        );
        const imgPath = args.image_path;
        if (!fs.existsSync(imgPath))
          throw new Error(`Image not found: ${imgPath}`);
        const attachment = new AttachmentBuilder(imgPath);
        const embed = new EmbedBuilder();
        embed.setImage(`attachment://${path.basename(imgPath)}`);
        if (args.message) embed.setTitle(args.message);
        await channel.send({
          embeds: [embed],
          files: [attachment],
        });
        return {
          content: [
            {
              type: "text",
              text: `Image "${path.basename(imgPath)}" sent to #${channel.name} in ${channel.guild.name}`,
            },
          ],
        };
      }

      case "discord_send_dm": {
        const user = await resolveUser(args.user);
        const dmChannel = await user.createDM();
        const parts = [];
        if (args.message) parts.push(args.message);
        if (args.code)
          parts.push(formatCodeBlock(args.code, args.language || ""));
        const content = parts.join("\n");
        const sendOpts = { content: content || undefined };
        if (args.file_path) {
          if (!fs.existsSync(args.file_path))
            throw new Error(`File not found: ${args.file_path}`);
          sendOpts.files = [new AttachmentBuilder(args.file_path)];
        }
        await dmChannel.send(sendOpts);
        return {
          content: [
            {
              type: "text",
              text: `DM sent to ${user.username} (${user.id})`,
            },
          ],
        };
      }

      case "discord_list_channels": {
        const guild = resolveGuild(args.server);
        await guild.channels.fetch();
        const textChannels = guild.channels.cache
          .filter((c) => c.isTextBased() && !c.isThread())
          .map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            category: c.parent?.name || "none",
          }));
        return {
          content: [
            {
              type: "text",
              text: `Channels in ${guild.name}:\n${JSON.stringify(textChannels, null, 2)}`,
            },
          ],
        };
      }

      case "discord_list_members": {
        const guild = resolveGuild(args.server);
        const limit = Math.min(args.limit || 50, 100);
        const members = await guild.members.fetch({ limit });
        const memberList = members.map((m) => ({
          id: m.id,
          username: m.user.username,
          displayName: m.displayName,
          globalName: m.user.globalName,
          bot: m.user.bot,
        }));
        return {
          content: [
            {
              type: "text",
              text: `Members in ${guild.name}:\n${JSON.stringify(memberList, null, 2)}`,
            },
          ],
        };
      }

      case "discord_list_servers": {
        const serverList = Object.entries(GUILDS).map(([alias, id]) => {
          const guild = discord.guilds.cache.get(id);
          return {
            alias,
            id,
            name: guild?.name || "not connected",
            default: alias === DEFAULT_GUILD_ALIAS,
          };
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(serverList, null, 2),
            },
          ],
        };
      }

      case "discord_add_user_mapping": {
        USER_MAPPINGS[args.alias.toLowerCase()] = args.user_id;
        return {
          content: [
            {
              type: "text",
              text: `Mapped "${args.alias}" -> ${args.user_id} (session only)`,
            },
          ],
        };
      }

      case "discord_read_messages": {
        const channel = await resolveChannelWithServer(
          args.channel,
          args.server
        );
        const limit = Math.min(args.limit || 10, 50);
        const messages = await channel.messages.fetch({ limit });
        const formatted = messages.reverse().map((m) => ({
          author: m.author.username,
          content: m.content,
          timestamp: m.createdAt.toISOString(),
          attachments: m.attachments.map((a) => a.url),
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Discord MCP server running");
}

main().catch(console.error);
