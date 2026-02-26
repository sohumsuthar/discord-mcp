# discord-mcp

An MCP (Model Context Protocol) server that bridges Claude Code with Discord. Send messages, files, images, and code snippets to any Discord server — directly from your terminal.

## Why?

Claude Code runs in your terminal. Discord runs on every device. This MCP server connects the two, letting Claude:

- **Notify you** when long tasks finish — check from your phone
- **Share code snippets** with syntax highlighting to any channel
- **Send files and images** from your local machine
- **DM specific people** by name
- **Read messages** from channels for context
- **Route across multiple servers** with simple aliases

## Quick Start

### 1. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application → go to **Bot** tab → copy the token
3. Enable **Privileged Gateway Intents**: MESSAGE CONTENT, SERVER MEMBERS, PRESENCE
4. Go to **OAuth2 → URL Generator** → scope: `bot` → permissions: Send Messages, Attach Files, Embed Links, Read Message History, View Channels
5. Use the generated URL to invite the bot to your server(s)

### 2. Install

```bash
git clone https://github.com/sohumsuthar/discord-mcp.git
cd discord-mcp
npm install
```

### 3. Configure Claude Code

Add to your `~/.claude.json` under `projects.<your-project-path>.mcpServers`:

```json
"discord": {
  "type": "stdio",
  "command": "node",
  "args": ["/path/to/discord-mcp/index.js"],
  "env": {
    "DISCORD_TOKEN": "your-bot-token",
    "DISCORD_GUILDS": "{\"myserver\":\"guild-id-here\"}",
    "DISCORD_DEFAULT_CHANNEL_ID": "channel-id-here",
    "DISCORD_USER_MAPPINGS": "{\"john\":\"user-id-here\"}"
  }
}
```

### 4. Restart Claude Code

The Discord tools will be available immediately.

## Tools

| Tool | Description |
|---|---|
| `discord_send_message` | Send text to a channel |
| `discord_send_code` | Send syntax-highlighted code blocks |
| `discord_send_file` | Attach a local file |
| `discord_send_image` | Send an image with embed |
| `discord_send_dm` | Direct message a user |
| `discord_list_channels` | List server channels |
| `discord_list_members` | List server members |
| `discord_list_servers` | Show configured servers |
| `discord_read_messages` | Read recent channel messages |
| `discord_add_user_mapping` | Map aliases to user IDs |

## Multi-Server Support

Configure multiple servers with aliases:

```json
"DISCORD_GUILDS": "{\"personal\":\"123456\",\"work\":\"789012\"}"
```

Then tell Claude: *"send this to work #dev-channel"* or *"post the logs to personal"*

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Bot token |
| `DISCORD_GUILDS` | Yes | JSON: `{"alias": "guild_id"}` |
| `DISCORD_DEFAULT_CHANNEL_ID` | No | Fallback channel ID |
| `DISCORD_USER_MAPPINGS` | No | JSON: `{"name": "user_id"}` |

## Cross-Platform

Works on macOS, Windows, and Linux — anywhere Claude Code runs. Clone the repo, `npm install`, and point your config at it.

### Windows

```powershell
cd $env:USERPROFILE\.claude\mcp-servers
git clone https://github.com/sohumsuthar/discord-mcp.git
cd discord-mcp
npm install
```

Then add to `C:\Users\<username>\.claude.json` with Windows-style paths in the `args` array.

## License

MIT
