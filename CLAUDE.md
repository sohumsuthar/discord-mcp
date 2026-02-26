# discord-mcp

MCP server that gives Claude Code the ability to send messages, files, images, and code snippets through Discord. Supports multiple servers with alias-based routing.

## Setup

1. Install dependencies: `npm install`
2. Configure in `~/.claude.json` under `projects.<path>.mcpServers.discord` with:
   - `DISCORD_TOKEN` — Bot token from Discord Developer Portal
   - `DISCORD_GUILDS` — JSON mapping aliases to guild IDs (e.g. `{"personal":"123","checkpoint":"456"}`)
   - `DISCORD_DEFAULT_CHANNEL_ID` — Default channel for messages when none specified
   - `DISCORD_USER_MAPPINGS` — JSON mapping friendly names to user IDs

## Multi-Server Routing

Every tool accepts an optional `server` parameter to target a specific Discord server by alias.
If no server is specified, defaults to the first alias with key `"personal"`, or the first entry.

## Available Tools

| Tool | Description |
|---|---|
| `discord_send_message` | Send text to a channel |
| `discord_send_code` | Send syntax-highlighted code blocks |
| `discord_send_file` | Send a local file as attachment |
| `discord_send_image` | Send an image with embed |
| `discord_send_dm` | DM a user by name, alias, or ID |
| `discord_list_channels` | List text channels in a server |
| `discord_list_members` | List server members |
| `discord_list_servers` | List all configured servers and aliases |
| `discord_read_messages` | Read recent messages from a channel |
| `discord_add_user_mapping` | Map a friendly alias to a user ID |

## Architecture

```
Claude Code <--stdio/MCP--> index.js <--Discord.js API--> Multiple Discord Servers
```

## Bot Requirements

Discord Developer Portal:
- Privileged Gateway Intents: MESSAGE CONTENT, SERVER MEMBERS, PRESENCE
- Bot Permissions: Send Messages, Attach Files, Embed Links, Read Message History, View Channels
