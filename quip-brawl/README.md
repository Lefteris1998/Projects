# Quip Brawl

A party game for 3–8 players. Each player answers funny prompts on their phone, then everyone votes on the best answer. No npm packages needed.

## Play locally (same Wi-Fi)

```
node server.js
```

Open `http://localhost:8081/host` on the big screen (TV/laptop). Players scan the QR code or go to the address shown.

## Play online with friends

Deploy to any Node host (Render, Railway, Fly.io…). Start command: `npm start`. The server reads the `PORT` it is given.

- Big screen: `https://your-app-url/host`
- Players: `https://your-app-url/` and enter the room code

Rooms live in memory, so restarting the server ends any game in progress.
