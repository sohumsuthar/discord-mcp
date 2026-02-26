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
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const DEFAULT_CHANNEL_ID = process.env.DISCORD_DEFAULT_CHANNEL_ID || null;

// User mappings: name -> discord user ID (set via env as JSON)
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

// Helper: resolve channel by ID or name
async function resolveChannel(channelIdOrName) {
  await waitForDiscord();
  const guild = discord.guilds.cache.get(GUILD_ID);
  if (!guild) throw new Error(`Guild ${GUILD_ID} not found`);

  // Try by ID first
  let channel = guild.channels.cache.get(channelIdOrName);
  if (channel) return channel;

  // Try by name
  channel = guild.channels.cache.find(
    (c) =>
      c.name === channelIdOrName ||
      c.name === channelIdOrName.replace(/^#/, "")
  );
  if (channel) return channel;

  // Fetch and retry
  await guild.channels.fetch();
  channel = guild.channels.cache.get(channelIdOrName);
  if (channel) return channel;
  channel = guild.channels.cache.find(
    (c) =>
      c.name === channelIdOrName ||
      c.name === channelIdOrName.replace(/^#/, "")
  );
  if (channel) return channel;

  throw new Error(`Channel "${channelIdOrName}" not found`);
}

// Helper: resolve user for DM
async function resolveUser(nameOrId) {
  await waitForDiscord();

  // Check mappings first
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

  // Try as raw ID
  if (/^\d+$/.test(nameOrId)) {
    try {
      return await discord.users.fetch(nameOrId);
    } catch {
      throw new Error(`User with ID ${nameOrId} not found`);
    }
  }

  // Search guild members by username/displayName
  const guild = discord.guilds.cache.get(GUILD_ID);
  if (guild) {
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

// Format code block for Discord
function formatCodeBlock(code, language = "") {
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

// MCP Server
const server = new Server(
  { name: "discord-bot", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "discord_send_message",
      description:
        "Send a text message to a Discord channel. Use channel name (e.g. 'general') or channel ID. If no channel specified, uses default channel.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The message text to send" },
          channel: {
            type: "string",
            description:
              "Channel name or ID (optional, uses default if not set)",
          },
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
            description:
              "Programming language for syntax highlighting (e.g. python, javascript, rust)",
          },
          title: {
            type: "string",
            description: "Optional title/description above the code block",
          },
          channel: { type: "string", description: "Channel name or ID" },
        },
        required: ["code"],
      },
    },
    {
      name: "discord_send_file",
      description:
        "Send a file from the local filesystem to a Discord channel.",
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
        },
        required: ["file_path"],
      },
    },
    {
      name: "discord_send_image",
      description:
        "Send an image from the local filesystem to a Discord channel.",
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
            description:
              "Username, display name, mapped alias, or user ID",
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
      description: "List all text channels in the Discord server.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "discord_list_members",
      description:
        "List members of the Discord server. Useful for finding user IDs for DMs.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max members to return (default 50)",
          },
        },
      },
    },
    {
      name: "discord_add_user_mapping",
      description:
        "Add a friendly name mapping for a Discord user, so you can refer to them by a short alias.",
      inputSchema: {
        type: "object",
        properties: {
          alias: {
            type: "string",
            description:
              'The friendly name/alias (e.g. "john", "boss", "teammate")',
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
        const channelId = args.channel || DEFAULT_CHANNEL_ID;
        if (!channelId)
          throw new Error("No channel specified and no default channel set");
        const channel = await resolveChannel(channelId);
        // Split long messages (Discord 2000 char limit)
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
              text: `Message sent to #${channel.name}`,
            },
          ],
        };
      }

      case "discord_send_code": {
        const channelId = args.channel || DEFAULT_CHANNEL_ID;
        if (!channelId)
          throw new Error("No channel specified and no default channel set");
        const channel = await resolveChannel(channelId);
        const codeBlock = formatCodeBlock(args.code, args.language || "");
        const fullMessage = args.title
          ? `**${args.title}**\n${codeBlock}`
          : codeBlock;

        // If too long for a message, send as file attachment
        if (fullMessage.length > 2000) {
          const ext = args.language
            ? `.${args.language}`
            : ".txt";
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
              text: `Code snippet sent to #${channel.name}`,
            },
          ],
        };
      }

      case "discord_send_file": {
        const channelId = args.channel || DEFAULT_CHANNEL_ID;
        if (!channelId)
          throw new Error("No channel specified and no default channel set");
        const channel = await resolveChannel(channelId);
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
              text: `File "${path.basename(filePath)}" sent to #${channel.name}`,
            },
          ],
        };
      }

      case "discord_send_image": {
        const channelId = args.channel || DEFAULT_CHANNEL_ID;
        if (!channelId)
          throw new Error("No channel specified and no default channel set");
        const channel = await resolveChannel(channelId);
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
              text: `Image "${path.basename(imgPath)}" sent to #${channel.name}`,
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
        const guild = discord.guilds.cache.get(GUILD_ID);
        if (!guild) throw new Error("Guild not found");
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
              text: JSON.stringify(textChannels, null, 2),
            },
          ],
        };
      }

      case "discord_list_members": {
        const guild = discord.guilds.cache.get(GUILD_ID);
        if (!guild) throw new Error("Guild not found");
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
              text: JSON.stringify(memberList, null, 2),
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
              text: `Mapped "${args.alias}" → ${args.user_id}. Note: this mapping lasts for this session only.`,
            },
          ],
        };
      }

      case "discord_read_messages": {
        const channelId = args.channel || DEFAULT_CHANNEL_ID;
        if (!channelId) throw new Error("No channel specified");
        const channel = await resolveChannel(channelId);
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

// Start
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Discord MCP server running");
}

main().catch(console.error);
