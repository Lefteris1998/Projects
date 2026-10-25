# Quip Brawl

A gravity-flip race for 2–8 players, after Gravity Guy. Everyone plays on their own phone. You run on your own; tap anywhere to flip gravity between floor and ceiling. Snag on a wall or fall off the track and the pursuer gets you. Last runner standing wins the round. No npm packages needed.

There's one lobby for everyone: open the page, pick a name, tap Ready. The race starts 3 seconds after everyone is ready, or 10 seconds after at least two are.

## Play locally (same Wi-Fi)

```
node server.js
```

Every phone opens the address it prints (`http://<your-computer's-ip>:8081/`).

## Play online

Deploy to any Node host (Render, Railway, Fly.io…). Start command: `npm start`. The server reads the `PORT` it is given. Everyone opens the site's address.

Lobby and races live in memory, so restarting the server ends any race in progress.

## Files

- `world.js`: the rules shared by phones and server (speed, pursuer, physics, the seeded track)
- `game.js`: the phone: lobby, your runner, drawing
- `server.js`: lobby, race control, position relay (WebSocket written by hand)
