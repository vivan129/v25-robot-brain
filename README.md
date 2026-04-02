# V25 Robot Brain

Local, lightweight web app for a Raspberry Pi 3B+ with voice input, OpenAI responses, and speech output.

## Setup

1. Copy `.env.example` to `.env` and add your OpenAI key.
2. Run:

```bash
node server.js
```

Then open `http://localhost:3000`.

## Notes

- The UI is full-screen friendly for a 7" display.
- Audio capture uses the browser microphone.
- All AI calls are proxied through the local Node server.
- Wake word mode listens for "V25" and then captures the next phrase.
