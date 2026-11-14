# Agent skills (Production Run Calculator)

Installed for the local Code Agent. Skills are markdown workflows the chat UI can inject.

## Usage in chat
- Type `/skills` to list
- Type `/skill <slug>` to load one into context
- Or pick from the Skills panel when available

## Safety
- Adapted off pure Replit deployment assumptions where possible
- Still do not use skills to access plant volumes or secrets

## Policy
Default Code Agent remains least-privilege. Skills guide behavior; they do not grant shell/MCP by themselves.
