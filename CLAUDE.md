# discord-mcp

MCP server that gives Claude Code the ability to send messages, files, images, and code snippets through Discord.

## Setup

1. Install dependencies: `npm install`
2. Configure in `~/.claude.json` under `projects.<path>.mcpServers.discord` with:
   - `DISCORD_TOKEN` — Bot token from Discord Developer Portal
   - `DISCORD_GUILD_ID` — Target server ID
   - `DISCORD_DEFAULT_CHANNEL_ID` — Default channel for messages
   - `DISCORD_USER_MAPPINGS` — JSON object mapping friendly names to user IDs

## Available Tools

| Tool | Description |
|---|---|
| `discord_send_message` | Send text to a channel (defaults to configured channel) |
| `discord_send_code` | Send syntax-highlighted code blocks |
| `discord_send_file` | Send a local file as attachment |
| `discord_send_image` | Send an image with embed |
| `discord_send_dm` | DM a user by name, alias, or ID |
| `discord_list_channels` | List all text channels in the server |
| `discord_list_members` | List server members |
| `discord_read_messages` | Read recent messages from a channel |
| `discord_add_user_mapping` | Map a friendly alias to a Discord user ID |

## Architecture

```
Claude Code <--stdio/MCP--> index.js <--Discord.js API--> Discord Server
```

The server runs as a child process of Claude Code via stdio transport. It maintains a persistent Discord client connection and exposes tools through the MCP protocol.

## Bot Requirements

Discord Developer Portal settings:
- Privileged Gateway Intents: MESSAGE CONTENT, SERVER MEMBERS, PRESENCE
- Bot Permissions: Send Messages, Attach Files, Embed Links, Read Message History, View Channels
