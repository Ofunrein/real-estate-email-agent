<!-- converted from Gmail_AI_Agent_Setup_Guide (2).docx -->

# Gmail AI Agent Setup Guide
Build an AI email agent that automatically responds to customer emails using Claude AI.
## What You Need
- Gmail account (the one you want the agent to monitor)
- Anthropic API key (get from console.anthropic.com/settings/keys)
- Google Sheet with your inventory/FAQ data
## Google Cloud Console Setup
Watch: 1:05:11 - 1:08:27
- Go to console.cloud.google.com
- Sign in with the Gmail account you want the agent to use
- Click the project dropdown (top left) → New Project
- Name it anything (e.g., "Email Agent") → Create
- Enable APIs: Search for "Gmail API" → Enable
- Search for "Google Sheets API" → Enable
## Create OAuth Credentials
Watch: 1:07:19 - 1:08:27
- Left sidebar → Credentials
- Click "Configure Consent Screen"
- Choose External → Next
- App name: "Email Agent" (or anything)
- User support email: your email
- Developer email: your email
- Save and Continue (skip scopes)
- Test users → Add your Gmail → Save and Continue
- Back to Credentials → Create Credentials → OAuth client ID
- Application type: Desktop app
- Name: "Desktop Client" → Create
- Download JSON → Save as credentials.json
- IMPORTANT: Click on the credential you just created → Authorized redirect URIs → ADD URI → Enter: http://localhost:8080/ → Save
## Claude Code Setup
Watch: 1:01:54 - 1:03:21
- Install VS Code from code.visualstudio.com
- Open VS Code → Extensions (left sidebar) → Search "Claude" → Install Claude extension by Anthropic
- Create a new folder for your project
- Open Claude Code (click Claude icon in top right)
- Click "Open Folder" → Select your project folder
## Add Required Files
Watch: 1:04:15 - 1:05:11
- Drop your credentials.json file into the Claude Code chat
- Create/upload your FAQ as faq.md (markdown file with your business info)
## Build the Agent (One Prompt)
Watch: 1:03:11 - 1:04:15
- Update the prompt with your Google Sheet ID and Calendly link
- Paste the full prompt into Claude Code
- Switch to Plan Mode (bottom right of chat)
- Let it build everything → Approve the plan
## Run the Agent
Watch: 1:13:31 - 1:14:37
- Run the command Claude Code provides (usually python3 email_agent.py)
- Browser opens → Sign in with your Gmail → Allow permissions
- Paste your Anthropic API key when prompted
- Agent starts polling every 60 seconds
## Test the Agent
Watch: 1:15:26 - 1:16:44
Send a test email to the Gmail account. Examples:
• "Do you have any Honda Accords?"
• "I'd like to schedule a test drive"
• "What are your hours?"
Watch the terminal – it will process and respond within 60 seconds.
## Important Notes
• No Re-Authentication Required: After the first run, the agent saves a token.json file. You won't need to sign in again – just run the script and it starts immediately.
• Only New Emails: The agent only processes emails that arrive AFTER you start it. Existing unread emails are ignored.
• Stop the Agent: Press Ctrl+C in the terminal
• For Production: Deploy to a $5/month VPS (DigitalOcean, AWS, etc.) so it runs 24/7 even when your laptop is off
Full Tutorial: https://youtu.be/_nt-9JChs2w